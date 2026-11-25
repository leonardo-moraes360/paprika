package team

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/leonardo-moraes360/paprika/server/internal/server"
)

// Service is the team side of a running server: the sidecar, its last status and the HTTP/WS
// surface the canvas uses.
type Service struct {
	store *server.Store
	opts  Options
	log   func(string)

	scMu sync.Mutex
	sc   *Sidecar // swapped by a key rotation: read it through side()

	mu        sync.Mutex
	status    json.RawMessage
	listeners map[int]func(string)
	nextID    int
	stopPres  func()
	stopDocs  func()
	stopPins  func()
	sync      *syncer
}

// New starts the sidecar for store. The returned service must be closed.
func New(ctx context.Context, store *server.Store, opts Options, log func(string)) (*Service, error) {
	if log == nil {
		log = func(string) {}
	}
	t := &Service{store: store, opts: opts, log: log, listeners: map[int]func(string){}}
	t.sync = newSyncer(t)
	sc, err := Start(ctx, opts, t.onEvent)
	if err != nil {
		t.sync.close()
		return nil, err
	}
	t.sc = sc
	t.sync.enqueue(t.sync.start)
	t.stopDocs = store.OnChange(func(ev server.ChangeEvent) { t.sync.enqueue(func() { t.sync.onChange(ev) }) })
	t.stopPins = store.OnPins(func(docID string) { t.sync.enqueue(func() { t.sync.pushPins(docID) }) })
	// Local agents' presence goes to the peers; presence that came from peers is not sent back.
	t.stopPres = store.Presence.OnPresence(func(p server.Presence) {
		if strings.HasPrefix(p.Agent, "peer:") {
			return
		}
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = t.side().Call(c, map[string]any{"t": "presence", "data": map[string]any{
			"agent": p.Agent, "actor": p.Actor, "tool": p.Tool, "nodes": p.Nodes, "doc": store.DocID()}})
	})
	return t, nil
}

// Sidecar exposes the process (tests, CLI).
func (t *Service) Sidecar() *Sidecar { return t.side() }

func (t *Service) side() *Sidecar {
	t.scMu.Lock()
	defer t.scMu.Unlock()
	return t.sc
}

// RotateKey gives this instance a new member key (signed by the old one and spread to the
// team), then restarts the sidecar with it: Iroh binds the endpoint to the key.
func (t *Service) RotateKey(ctx context.Context) (json.RawMessage, error) {
	t.sync.flush() // changes signed by the old key go out first
	res, err := t.side().Call(ctx, map[string]any{"t": "key.rotate"})
	if err != nil {
		return nil, err
	}
	t.scMu.Lock()
	defer t.scMu.Unlock()
	t.sc.Close()
	sc, err := Start(ctx, t.opts, t.onEvent)
	if err != nil {
		return nil, fmt.Errorf("the key changed but the sidecar did not restart: %w (restart Paprika)", err)
	}
	t.sc = sc
	t.log("time: chave trocada; sidecar reiniciado com " + sc.ID[:8])
	return res, nil
}

// Close stops the sidecar.
func (t *Service) Close() {
	if t.stopPres != nil {
		t.stopPres()
	}
	if t.stopDocs != nil {
		t.stopDocs()
	}
	if t.stopPins != nil {
		t.stopPins()
	}
	t.sync.flush()
	t.sync.close()
	t.side().Close()
}

func (t *Service) onEvent(ev Event) {
	switch ev.Type() {
	case "status":
		raw, _ := json.Marshal(ev["status"])
		t.mu.Lock()
		t.status = raw
		t.mu.Unlock()
		t.broadcast(t.statusMessage(raw))
	case "presence":
		peer, _ := ev["peer"].(string)
		data, _ := ev["data"].(map[string]any)
		if data == nil || len(peer) < 8 {
			return
		}
		if doc, _ := data["doc"].(string); doc != "" && doc != t.store.DocID() {
			return // the peer's agent is in another workspace
		}
		agent, _ := data["agent"].(string)
		actor, _ := data["actor"].(string)
		tool, _ := data["tool"].(string)
		var nodes []string
		if arr, ok := data["nodes"].([]any); ok {
			for _, n := range arr {
				if s, ok := n.(string); ok {
					nodes = append(nodes, s)
				}
			}
		}
		name, _ := ev["name"].(string)
		if name == "" {
			name = t.peerName(peer)
		}
		t.store.Presence.Report("peer:"+peer[:8]+":"+agent, actor+" @ "+name, tool, nodes)
	case "remote":
		doc, _ := ev["doc"].(string)
		state, _ := json.Marshal(ev["state"])
		var by []string
		if arr, ok := ev["by"].([]any); ok {
			for _, b := range arr {
				if s, ok := b.(string); ok {
					by = append(by, s)
				}
			}
		}
		t.sync.enqueue(func() { t.sync.onRemote(doc, state, by) })
	case "log":
		t.log(fmt.Sprintf("sync: %v", ev["msg"]))
	case "rejected":
		t.log(fmt.Sprintf("sync: recusado %v (%v)", ev["peer"], ev["reason"]))
	case "joined":
		t.log(fmt.Sprintf("time: %v entrou com um convite", ev["name"]))
	case "removed":
		t.log(fmt.Sprintf("time: %v removido(a) do time", ev["peer"]))
	}
}

func (t *Service) peerName(id string) string {
	var st struct {
		Peers []struct{ ID, Name string } `json:"peers"`
	}
	t.mu.Lock()
	_ = json.Unmarshal(t.status, &st)
	t.mu.Unlock()
	for _, p := range st.Peers {
		if p.ID == id && p.Name != "" {
			return p.Name
		}
	}
	return id[:8]
}

func (t *Service) statusMessage(raw json.RawMessage) string {
	b, _ := json.Marshal(map[string]any{"type": "team", "status": raw})
	return string(b)
}

func (t *Service) broadcast(msg string) {
	t.mu.Lock()
	ls := make([]func(string), 0, len(t.listeners))
	for _, fn := range t.listeners {
		ls = append(ls, fn)
	}
	t.mu.Unlock()
	for _, fn := range ls {
		fn(msg)
	}
}

// OnMessage subscribes to WebSocket messages ({type: "team", …}); returns the unsubscribe.
func (t *Service) OnMessage(fn func(string)) func() {
	t.mu.Lock()
	defer t.mu.Unlock()
	id := t.nextID
	t.nextID++
	t.listeners[id] = fn
	return func() {
		t.mu.Lock()
		delete(t.listeners, id)
		t.mu.Unlock()
	}
}

// Recent is what a canvas that just connected needs: the last status.
func (t *Service) Recent() []string {
	t.mu.Lock()
	raw := t.status
	t.mu.Unlock()
	if raw == nil {
		return nil
	}
	return []string{t.statusMessage(raw)}
}

// Status asks the sidecar for the current status.
func (t *Service) Status(ctx context.Context) (json.RawMessage, error) {
	return t.side().Call(ctx, map[string]any{"t": "status"})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func errJSON(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]any{"error": err.Error()})
}

func readJSON(r *http.Request, v any) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		return err
	}
	if len(body) == 0 {
		return nil
	}
	return json.Unmarshal(body, v)
}

// call proxies an HTTP request body to a sidecar command and writes its result.
func (t *Service) call(w http.ResponseWriter, r *http.Request, cmd map[string]any) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	res, err := t.side().Call(ctx, cmd)
	t.reply(w, res, err)
}

func (t *Service) reply(w http.ResponseWriter, res json.RawMessage, err error) {
	if err != nil {
		errJSON(w, 400, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if len(res) == 0 || string(res) == "null" {
		res = json.RawMessage(`{}`)
	}
	_, _ = w.Write(res)
}

// Share starts sharing a workspace with the team (the active one when doc is empty).
func (t *Service) Share(doc string) error {
	if doc == "" {
		doc = t.store.DocID()
	}
	errc := make(chan error, 1)
	t.sync.enqueue(func() { errc <- t.sync.share(doc) })
	return <-errc
}

// Flush waits until every change queued so far reached the sidecar or the store.
func (t *Service) Flush() { t.sync.flush() }

// Routes registers /api/team/* on the Gin router.
func (t *Service) Routes(r gin.IRoutes) {
	r.POST("/api/team/share", func(c *gin.Context) {
		var body struct {
			Doc string `json:"doc"`
		}
		if err := readJSON(c.Request, &body); err != nil {
			errJSON(c.Writer, 400, err)
			return
		}
		if body.Doc == "" {
			body.Doc = t.store.DocID()
		}
		if err := t.Share(body.Doc); err != nil {
			errJSON(c.Writer, 400, err)
			return
		}
		writeJSON(c.Writer, 200, map[string]any{"doc": body.Doc})
	})
	r.GET("/api/team", func(c *gin.Context) {
		t.call(c.Writer, c.Request, map[string]any{"t": "status"})
	})
	r.POST("/api/team/peers", func(c *gin.Context) {
		var body struct {
			Addr json.RawMessage `json:"addr"`
		}
		if err := readJSON(c.Request, &body); err != nil || len(body.Addr) == 0 {
			errJSON(c.Writer, 400, fmt.Errorf("body: {\"addr\": <endpoint address>}"))
			return
		}
		t.call(c.Writer, c.Request, map[string]any{"t": "peer.add", "addr": body.Addr})
	})
	r.GET("/api/team/addr", func(c *gin.Context) {
		t.call(c.Writer, c.Request, map[string]any{"t": "addr"})
	})
	r.POST("/api/team", func(c *gin.Context) {
		var body struct {
			Name string `json:"name"`
		}
		if err := readJSON(c.Request, &body); err != nil {
			errJSON(c.Writer, 400, err)
			return
		}
		t.call(c.Writer, c.Request, map[string]any{"t": "team.create", "name": body.Name})
	})
	r.POST("/api/team/invites", func(c *gin.Context) {
		var body struct {
			TTLSecs int `json:"ttlSecs"`
		}
		if err := readJSON(c.Request, &body); err != nil {
			errJSON(c.Writer, 400, err)
			return
		}
		if body.TTLSecs <= 0 {
			body.TTLSecs = 3600
		}
		t.call(c.Writer, c.Request, map[string]any{"t": "invite.create", "ttlSecs": body.TTLSecs})
	})
	r.DELETE("/api/team/invites", func(c *gin.Context) {
		t.call(c.Writer, c.Request, map[string]any{"t": "invite.revoke"})
	})
	r.POST("/api/team/invites/inspect", func(c *gin.Context) {
		var body struct {
			Link string `json:"link"`
		}
		if err := readJSON(c.Request, &body); err != nil {
			errJSON(c.Writer, 400, err)
			return
		}
		t.call(c.Writer, c.Request, map[string]any{"t": "invite.inspect", "link": body.Link})
	})
	r.DELETE("/api/team/members/:key", func(c *gin.Context) {
		t.call(c.Writer, c.Request, map[string]any{"t": "member.remove", "key": c.Param("key")})
	})
	r.POST("/api/team/leave", func(c *gin.Context) {
		t.call(c.Writer, c.Request, map[string]any{"t": "member.leave"})
	})
	r.POST("/api/team/rotate", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
		defer cancel()
		res, err := t.RotateKey(ctx)
		t.reply(c.Writer, res, err)
	})
	r.POST("/api/team/join", func(c *gin.Context) {
		var body struct {
			Link string `json:"link"`
		}
		if err := readJSON(c.Request, &body); err != nil {
			errJSON(c.Writer, 400, err)
			return
		}
		t.call(c.Writer, c.Request, map[string]any{"t": "join", "link": body.Link})
	})
}
