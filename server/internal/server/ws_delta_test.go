package server

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func parseOps(t *testing.T, src string) []any {
	t.Helper()
	v, err := jsonv.Parse([]byte(src))
	if err != nil {
		t.Fatal(err)
	}
	return v.([]any)
}

type deltaModel struct {
	doc     *core.Document
	version int64
}

func (m *deltaModel) snapshot(doc *core.Document, version int64) {
	m.doc = jsonv.Clone(doc).(*core.Document)
	m.version = version
}

func patchMap(t *testing.T, doc *core.Document, key string, patch *jsonv.Object) {
	t.Helper()
	cur := doc.Obj(key)
	if cur == nil {
		t.Fatalf("patch of absent map %s", key)
	}
	if set := patch.Obj("set"); set != nil {
		for _, k := range set.Keys() {
			v, _ := set.Get(k)
			cur.Set(k, v)
		}
	}
	for _, k := range patch.Arr("del") {
		cur.Delete(k.(string))
	}
}

func (m *deltaModel) apply(t *testing.T, msg string) {
	t.Helper()
	v, err := jsonv.Parse([]byte(msg))
	if err != nil {
		t.Fatal(err)
	}
	d := v.(*jsonv.Object)
	if d.Str("type") != "delta" {
		t.Fatalf("not a delta: %s", msg)
	}
	if int64(d.Num("base")) != m.version {
		t.Fatalf("base %v does not match applied %d", d.Num("base"), m.version)
	}
	if d.Has("name") {
		m.doc.Set("name", d.Str("name"))
	}
	if r, ok := d.Get("rootIds"); ok {
		m.doc.Set("rootIds", r)
	}
	for _, key := range []string{"nodes", "tokens", "modes", "tokenMeta", "assets"} {
		if p := d.Obj(key); p != nil {
			patchMap(t, m.doc, key, p)
		}
	}
	m.version = int64(d.Num("version"))
}

func collectEvents(s *Store) (*[]ChangeEvent, func()) {
	var evs []ChangeEvent
	off := s.OnChange(func(e ChangeEvent) { evs = append(evs, e) })
	return &evs, off
}

func TestDeltaCarriesOnlyTheChange(t *testing.T) {
	s, _ := openTemp(t)
	if _, err := s.Apply(parseOps(t, `[{"op":"create","node":{"type":"rect","id":"a"}},{"op":"create","node":{"type":"rect","id":"b"}},{"op":"create","node":{"type":"rect","id":"c"}}]`), "user", "seed"); err != nil {
		t.Fatal(err)
	}
	evs, off := collectEvents(s)
	defer off()
	step := func(ops string) *jsonv.Object {
		t.Helper()
		n := len(*evs)
		if _, err := s.Apply(parseOps(t, ops), "agent:x", "w"); err != nil {
			t.Fatal(err)
		}
		if len(*evs) != n+1 {
			t.Fatalf("events: %d", len(*evs)-n)
		}
		e := (*evs)[n]
		if e.Delta == nil {
			t.Fatalf("no delta for a plain apply: %s", ops)
		}
		v, _ := jsonv.Parse([]byte(deltaMessage(e, true, false)))
		d := v.(*jsonv.Object)
		if d.Num("base") != d.Num("version")-1 || d.Str("id") == "" || d.Str("actor") != "agent:x" {
			t.Fatalf("header: %s", jsonv.Stringify(d, ""))
		}
		return d
	}
	d := step(`[{"op":"update","id":"b","props":{"opacity":0.5}}]`)
	set := d.Obj("nodes").Obj("set")
	if set.Len() != 1 || !set.Has("b") || set.Obj("b").Num("opacity") != 0.5 || d.Obj("nodes").Has("del") || d.Has("tokens") || d.Has("rootIds") || d.Has("name") || d.Has("assets") {
		t.Fatalf("update delta: %s", jsonv.Stringify(d, ""))
	}
	d = step(`[{"op":"delete","id":"a"}]`)
	if got := jsonv.Stringify(d.Obj("nodes").Arr("del"), ""); got != `["a"]` || d.Obj("nodes").Has("set") {
		t.Fatalf("delete delta: %s", jsonv.Stringify(d, ""))
	}
	d = step(`[{"op":"create","node":{"type":"rect","id":"n1"}}]`)
	if !d.Obj("nodes").Obj("set").Has("n1") || !d.Has("rootIds") {
		t.Fatalf("create delta: %s", jsonv.Stringify(d, ""))
	}
	d = step(`[{"op":"set_tokens","tokens":{"brand":"#ff0000"}}]`)
	if d.Obj("tokens").Obj("set").Str("brand") != "#ff0000" || d.Has("nodes") {
		t.Fatalf("token delta: %s", jsonv.Stringify(d, ""))
	}
	d = step(`[{"op":"rename_document","name":"Novo"}]`)
	if d.Str("name") != "Novo" || d.Has("nodes") || d.Has("tokens") {
		t.Fatalf("rename delta: %s", jsonv.Stringify(d, ""))
	}
	n := len(*evs)
	if _, err := s.Apply(parseOps(t, `[{"op":"set_assets","assets":{"logo":"data:image/png;base64,AAAA"}}]`), "agent:x", "w"); err != nil {
		t.Fatal(err)
	}
	if (*evs)[n].Delta != nil {
		t.Fatal("first asset appears with a delta, the map did not exist before")
	}
	d = step(`[{"op":"set_assets","assets":{"logo2":"data:image/png;base64,BBBB"}}]`)
	if d.Obj("assets").Obj("set").Str("logo2") == "" || d.Has("nodes") {
		t.Fatalf("asset delta: %s", jsonv.Stringify(d, ""))
	}
}

func TestDeltaAsideWorkspace(t *testing.T) {
	s, _ := openTemp(t)
	other, err := s.CreateWorkspace("Outro", "user")
	if err != nil {
		t.Fatal(err)
	}
	var got []AsideEvent
	off := s.OnAside(func(e AsideEvent) { got = append(got, e) })
	defer off()
	if _, _, err := s.ApplyIn(other.ID, parseOps(t, `[{"op":"create","node":{"type":"rect","id":"z"}}]`), "user", "x", ""); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Delta == nil || got[0].Base != got[0].Version-1 || got[0].DocID != other.ID {
		t.Fatalf("aside event: %+v", got)
	}
}

func TestDeltasConvergeWithServerDocument(t *testing.T) {
	s, _ := openTemp(t)
	rng := rand.New(rand.NewSource(7))
	var model deltaModel
	deltas, snaps := 0, 0
	off := s.OnChange(func(e ChangeEvent) {
		if e.Delta != nil && e.Base == model.version {
			model.apply(t, deltaMessage(e, true, true))
			deltas++
			return
		}
		model.snapshot(e.Doc, e.Version)
		snaps++
	})
	defer off()
	doc, version, _, _ := s.Snapshot()
	model.snapshot(doc, version)
	ids := []string{}
	next := 0
	pick := func() string {
		if len(ids) == 0 {
			return "none"
		}
		return ids[rng.Intn(len(ids))]
	}
	for i := 0; i < 400; i++ {
		var ops string
		switch rng.Intn(9) {
		case 0, 1:
			next++
			id := fmt.Sprintf("n%d", next)
			parent := "null"
			if p := pick(); p != "none" && rng.Intn(2) == 0 {
				parent = `"` + p + `"`
			}
			typ := []string{"rect", "frame"}[rng.Intn(2)]
			ops = fmt.Sprintf(`[{"op":"create","node":{"type":"%s","id":"%s"},"parentId":%s}]`, typ, id, parent)
			if _, err := s.Apply(parseOps(t, ops), "user", "c"); err == nil {
				ids = append(ids, id)
			}
			continue
		case 2, 3:
			ops = fmt.Sprintf(`[{"op":"update","id":"%s","props":{"opacity":%v,"name":"v%d"}}]`, pick(), float64(rng.Intn(10))/10, i)
		case 4:
			id := pick()
			ops = fmt.Sprintf(`[{"op":"delete","id":"%s"}]`, id)
			if _, err := s.Apply(parseOps(t, ops), "user", "d"); err == nil {
				ids = slicesDelete(ids, id)
			}
			continue
		case 5:
			ops = fmt.Sprintf(`[{"op":"move","id":"%s","parentId":null,"index":%d}]`, pick(), rng.Intn(4))
		case 6:
			if _, err := s.Undo("user"); err != nil {
				t.Fatal(err)
			}
			continue
		case 7:
			if _, err := s.Redo("user"); err != nil {
				t.Fatal(err)
			}
			continue
		default:
			switch rng.Intn(3) {
			case 0:
				ops = fmt.Sprintf(`[{"op":"set_tokens","tokens":{"t%d":"#00%02x00"}}]`, rng.Intn(5), rng.Intn(256))
			case 1:
				ops = fmt.Sprintf(`[{"op":"rename_document","name":"doc %d"}]`, i)
			default:
				ops = fmt.Sprintf(`[{"op":"set_assets","assets":{"a%d":"data:image/png;base64,AAAA"}}]`, rng.Intn(3))
			}
		}
		_, _ = s.Apply(parseOps(t, ops), "user", "x")
		cur, ver, _, _ := s.Snapshot()
		if got, want := jsonv.Stringify(model.doc, ""), jsonv.Stringify(cur, ""); got != want || model.version != ver {
			t.Fatalf("step %d diverged at version %d/%d", i, model.version, ver)
		}
	}
	cur, ver, _, _ := s.Snapshot()
	if jsonv.Stringify(model.doc, "") != jsonv.Stringify(cur, "") || model.version != ver {
		t.Fatal("final document diverged")
	}
	if deltas < 100 {
		t.Fatalf("only %d deltas (and %d snapshots)", deltas, snaps)
	}
	t.Logf("deltas=%d snapshots=%d", deltas, snaps)
}

func slicesDelete(a []string, v string) []string {
	out := a[:0]
	for _, x := range a {
		if x != v {
			out = append(out, x)
		}
	}
	return out
}

func TestOutboxKeepsEveryDeltaInOrder(t *testing.T) {
	o := newOutbox(nil)
	o.pushDoc("snap1", "w", 1)
	for v := int64(2); v <= 5; v++ {
		if !o.pushDelta(fmt.Sprintf("d%d", v), "w", v-1, v) {
			t.Fatal("delta refused")
		}
	}
	o.push("presence")
	ctx := context.Background()
	var got []string
	for range 6 {
		m, ok := o.next(ctx)
		if !ok {
			t.Fatal("closed")
		}
		got = append(got, m)
	}
	if strings.Join(got, ",") != "snap1,d2,d3,d4,d5,presence" {
		t.Fatalf("got %v", got)
	}
}

func TestOutboxSnapshotSupersedesEarlierDeltas(t *testing.T) {
	o := newOutbox(nil)
	o.pushDoc("snap1", "w", 1)
	o.pushDelta("d2", "w", 1, 2)
	o.pushDelta("d3", "w", 2, 3)
	o.pushDoc("snap3", "w", 3)
	o.pushDelta("d4", "w", 3, 4)
	o.pushDelta("late", "w", 1, 2)
	ctx := context.Background()
	var got []string
	for range 2 {
		m, _ := o.next(ctx)
		got = append(got, m)
	}
	if strings.Join(got, ",") != "snap3,d4" || o.dpending != 0 {
		t.Fatalf("got %v pending %d", got, o.dpending)
	}
}

func TestOutboxRefusesDeltaOverBoundAndGap(t *testing.T) {
	oldN := wsDeltaMessages
	wsDeltaMessages = 3
	defer func() { wsDeltaMessages = oldN }()
	o := newOutbox(nil)
	o.pushDoc("snap1", "w", 1)
	if !o.pushDelta("d2", "w", 1, 2) || !o.pushDelta("d3", "w", 2, 3) || !o.pushDelta("d4", "w", 3, 4) {
		t.Fatal("deltas within bound refused")
	}
	if o.pushDelta("d5", "w", 4, 5) {
		t.Fatal("delta over the count bound accepted")
	}
	o2 := newOutbox(nil)
	o2.pushDoc("snap1", "w", 1)
	if o2.pushDelta("d3", "w", 2, 3) {
		t.Fatal("delta with a gap accepted")
	}
	wsDeltaMessages = oldN
	oldB := wsDeltaBytes
	wsDeltaBytes = 10
	defer func() { wsDeltaBytes = oldB }()
	o3 := newOutbox(nil)
	if o3.pushDelta(strings.Repeat("x", 11), "w", 0, 1) {
		t.Fatal("delta over the byte bound accepted")
	}
}

func TestBroadcastCollapsesOverflowIntoSnapshot(t *testing.T) {
	old := wsDeltaMessages
	wsDeltaMessages = 3
	defer func() { wsDeltaMessages = old }()
	s, _ := openTemp(t)
	hub := &wsHub{conns: map[*websocket.Conn]*outbox{}, renderer: map[*websocket.Conn]string{}, view: map[*websocket.Conn]string{}}
	c := new(websocket.Conn)
	ob := newOutbox(nil)
	hub.conns[c] = ob
	doc, version, _, _ := s.Snapshot()
	ob.pushDoc("initial", doc.Str("id"), version)
	if _, err := s.Apply(parseOps(t, `[{"op":"create","node":{"type":"rect","id":"r"}}]`), "user", "seed"); err != nil {
		t.Fatal(err)
	}
	snapshots := 0
	off := s.OnChange(func(e ChangeEvent) {
		hub.broadcastEvent(nil, e, func() (bool, bool) { return true, false }, func() string {
			snapshots++
			return "snapshot@" + fmt.Sprint(e.Version)
		})
	})
	defer off()
	for i := 0; i < 6; i++ {
		if _, err := s.Apply(parseOps(t, fmt.Sprintf(`[{"op":"update","id":"r","props":{"x":%d}}]`, i)), "user", "w"); err != nil {
			t.Fatal(err)
		}
	}
	if snapshots == 0 {
		t.Fatal("overflow never collapsed to a snapshot")
	}
	if ob.dpending > 3 {
		t.Fatalf("pending deltas %d", ob.dpending)
	}
	ctx := context.Background()
	var got []string
	for {
		ob.mu.Lock()
		n := len(ob.items)
		ob.mu.Unlock()
		if n == 0 {
			break
		}
		m, _ := ob.next(ctx)
		got = append(got, m)
	}
	last := got[len(got)-1]
	if !strings.Contains(last, fmt.Sprintf("%d", s.Version())) {
		t.Fatalf("queue does not end at version %d: %v", s.Version(), got)
	}
	if !strings.HasPrefix(got[0], "snapshot@") {
		t.Fatalf("snapshot does not lead the queue: %v", got)
	}
}

func TestLateFirstViewDoesNotRepeatTheSnapshotButResyncDoes(t *testing.T) {
	s, srv := startWS(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c := dialWS(t, ctx, srv, "")
	first, _, err := readMsg(t, ctx, c)
	if err != nil || first.Str("type") != "doc" {
		t.Fatalf("%v %v", first, err)
	}
	id := first.Obj("doc").Str("id")
	_ = s
	c.Write(ctx, websocket.MessageText, []byte(`{"type":"view","workspaceId":"`+id+`","reqId":"v1"}`))
	m, _, err := readMsg(t, ctx, c)
	if err != nil || m.Str("type") != "ack" {
		t.Fatalf("first view answered with %v %v", m, err)
	}
	c.Write(ctx, websocket.MessageText, []byte(`{"type":"view","workspaceId":"`+id+`","reqId":"v2"}`))
	m, _, err = readMsg(t, ctx, c)
	if err != nil || m.Str("type") != "doc" {
		t.Fatalf("resync view answered with %v %v", m, err)
	}
}

func TestFailedFirstViewStillGetsTheInitialSnapshot(t *testing.T) {
	_, srv := startWS(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c := dialWS(t, ctx, srv, "")
	c.Write(ctx, websocket.MessageText, []byte(`{"type":"view","workspaceId":"nope","reqId":"v1"}`))
	seen := map[string]bool{}
	for !seen["doc"] || !seen["error"] {
		m, _, err := readMsg(t, ctx, c)
		if err != nil {
			t.Fatalf("got %v: %v", seen, err)
		}
		seen[m.Str("type")] = true
	}
}
