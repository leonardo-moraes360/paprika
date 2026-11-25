package team

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
	"github.com/leonardo-moraes360/paprika/server/internal/server"
)

// syncer turns local commits into change sets for the sidecar and remote states into applyOps
// transactions. Everything runs on one goroutine, in the order it happened, so a change set is
// always the diff from the document the peers last saw from us.
type syncer struct {
	t *Service

	mu    sync.Mutex
	cond  *sync.Cond
	queue []func()
	stop  bool

	// Only touched on the worker goroutine.
	shared   map[string]bool
	pinSnaps map[string]*pinSnap
	lastID   string
	last     *core.Document
}

func newSyncer(t *Service) *syncer {
	s := &syncer{t: t, shared: map[string]bool{}}
	s.cond = sync.NewCond(&s.mu)
	go s.run()
	return s
}

// enqueue never blocks: the store calls it from inside its change notifications.
func (s *syncer) enqueue(fn func()) {
	s.mu.Lock()
	s.queue = append(s.queue, fn)
	s.mu.Unlock()
	s.cond.Signal()
}

func (s *syncer) run() {
	for {
		s.mu.Lock()
		for len(s.queue) == 0 && !s.stop {
			s.cond.Wait()
		}
		if s.stop {
			s.mu.Unlock()
			return
		}
		fn := s.queue[0]
		s.queue = s.queue[1:]
		s.mu.Unlock()
		fn()
	}
}

func (s *syncer) close() {
	s.mu.Lock()
	s.stop = true
	s.mu.Unlock()
	s.cond.Broadcast()
}

// flush waits until everything queued so far ran (tests, share).
func (s *syncer) flush() {
	done := make(chan struct{})
	s.enqueue(func() { close(done) })
	<-done
}

func (s *syncer) call(cmd map[string]any) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	return s.t.side().Call(ctx, cmd)
}

func metaKey(doc string) string { return "team.synced." + doc }

func (s *syncer) syncedVersion(doc string) int64 {
	var v string
	if err := s.t.store.DB().QueryRow(`SELECT value FROM meta WHERE key = ?`, metaKey(doc)).Scan(&v); err != nil {
		return -1
	}
	n, _ := strconv.ParseInt(v, 10, 64)
	return n
}

func (s *syncer) setSynced(doc string, version int64) {
	_, _ = s.t.store.DB().Exec(`INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		metaKey(doc), strconv.FormatInt(version, 10))
}

func (s *syncer) docVersion(doc string) int64 {
	var v int64
	_ = s.t.store.DB().QueryRow(`SELECT version FROM documents WHERE id = ?`, doc).Scan(&v)
	return v
}

// start loads the shared set and reconciles the active workspace. Runs on the worker.
func (s *syncer) start() {
	if res, err := s.call(map[string]any{"t": "docs"}); err == nil {
		var ids []string
		_ = json.Unmarshal(res, &ids)
		for _, id := range ids {
			s.shared[id] = true
		}
	}
	s.lastID = s.t.store.DocID()
	s.last = s.t.store.Doc()
	s.reconcile(s.lastID)
	for id := range s.shared {
		s.pullPinsFromSidecar(id)
		s.pushPins(id)
	}
}

// reconcile brings a shared workspace and the CRDT together after a start or a switch: when the
// database did not change since the last sync, the CRDT (which may hold peers' changes) wins;
// otherwise the database changed while the team was off (e.g. `paprika mcp` over stdio), and
// that difference is sent to the peers as a local change.
func (s *syncer) reconcile(doc string) {
	if !s.shared[doc] {
		return
	}
	raw, err := s.call(map[string]any{"t": "state", "doc": doc})
	if err != nil {
		s.t.log("sync: " + err.Error())
		return
	}
	state, err := stateDoc(raw)
	if err != nil {
		return
	}
	if s.syncedVersion(doc) == s.docVersion(doc) {
		s.applyRemote(doc, state, "peer:time", "sincronizar com o time")
		return
	}
	cur, err := s.t.store.WorkspaceDocument(doc)
	if err != nil {
		return
	}
	if changes := Diff(state, cur); len(changes) > 0 {
		if _, err := s.call(map[string]any{"t": "local", "doc": doc, "author": "user", "changes": changes}); err != nil {
			s.t.log("sync: " + err.Error())
			return
		}
	}
	s.setSynced(doc, s.docVersion(doc))
}

func (s *syncer) onChange(ev server.ChangeEvent) {
	switch ev.Kind {
	case "open":
		s.lastID, s.last = ev.DocID, ev.Doc
		s.reconcile(ev.DocID)
		return
	case "remote":
		if ev.DocID == s.lastID {
			s.last = ev.Doc
		}
		s.setSynced(ev.DocID, ev.Version)
		return
	}
	prev := s.last
	if ev.DocID != s.lastID || prev == nil {
		s.lastID, s.last = ev.DocID, ev.Doc
		return
	}
	s.last = ev.Doc
	if !s.shared[ev.DocID] {
		return
	}
	changes := Diff(prev, ev.Doc)
	if len(changes) == 0 {
		s.setSynced(ev.DocID, ev.Version)
		return
	}
	if _, err := s.call(map[string]any{"t": "local", "doc": ev.DocID, "author": ev.Actor, "changes": changes}); err != nil {
		s.t.log("sync: change set refused: " + err.Error())
		return
	}
	s.setSynced(ev.DocID, ev.Version)
}

// onRemote applies a workspace state that came from peers.
func (s *syncer) onRemote(doc string, rawState json.RawMessage, by []string) {
	s.shared[doc] = true
	state, err := stateDoc(rawState)
	if err != nil {
		s.t.log("sync: invalid state from the sidecar: " + err.Error())
		return
	}
	who := strings.Join(by, ", ")
	if who == "" {
		who = "time"
	}
	s.applyRemote(doc, state, "peer:"+who, "time: "+who)
	s.pullPins(doc, rawState)
	s.pushPins(doc)
}

func (s *syncer) applyRemote(doc string, state *core.Document, actor, label string) {
	res, err := s.t.store.ApplyRemote(doc, state.Str("name"), actor, label, func(cur *core.Document) []any {
		return RemoteOps(cur, state)
	})
	if err != nil {
		s.t.log("sync: " + err.Error())
		return
	}
	if len(res.Failed) > 0 {
		s.t.log(fmt.Sprintf("sync: %d de %d operações do time recusadas pelo core (merge inválido): %s", len(res.Failed), res.Ops, res.Failed[0]))
	}
	if doc != s.t.store.DocID() {
		s.setSynced(doc, s.docVersion(doc))
	}
}

// stateOf is the materialized state of a document, as the sidecar's `share` expects.
func stateOf(doc *core.Document) json.RawMessage {
	v := viewOf(doc)
	nodes := jsonv.NewObject()
	for _, id := range v.order {
		n := v.nodes[id].Spread()
		n.Set("parentId", nullable(v.parent[id]))
		if kids, ok := v.children[id]; ok {
			arr := make([]any, len(kids))
			for i, k := range kids {
				arr[i] = k
			}
			n.Set("children", arr)
		} else if core.IsContainer(n.Str("type")) {
			n.Set("children", []any{})
		}
		nodes.Set(id, n)
	}
	roots := make([]any, len(v.children[""]))
	for i, k := range v.children[""] {
		roots[i] = k
	}
	return raw(jsonv.NewObject("name", v.name, "rootIds", roots, "nodes", nodes, "tokens", v.tokens, "modes", v.modes))
}

// share starts sharing a workspace with the team. Runs on the worker.
func (s *syncer) share(doc string) error {
	if s.shared[doc] {
		return fmt.Errorf("workspace %s is already shared", doc)
	}
	d, err := s.t.store.WorkspaceDocument(doc)
	if err != nil {
		return err
	}
	if _, err := s.call(map[string]any{"t": "share", "doc": doc, "author": "user", "state": withPinState(s.t.store, doc, stateOf(d))}); err != nil {
		return err
	}
	s.shared[doc] = true
	if exported, err := s.t.store.ExportPins(doc); err == nil {
		if s.pinSnaps == nil {
			s.pinSnaps = map[string]*pinSnap{}
		}
		s.pinSnaps[doc] = snapFrom(exported)
	}
	s.pushPins(doc)
	if doc == s.lastID {
		s.last = d
	}
	s.setSynced(doc, s.docVersion(doc))
	return nil
}
