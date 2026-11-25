package server

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func startWS(t *testing.T) (*Store, *RunningServer) {
	t.Helper()
	s, _ := openTemp(t)
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { srv.Close() })
	return s, srv
}

func dialWS(t *testing.T, ctx context.Context, srv *RunningServer, query string) *websocket.Conn {
	t.Helper()
	c, _, err := websocket.Dial(ctx, strings.Replace(srv.URL, "http", "ws", 1)+"/ws"+query, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {srv.URL}}})
	if err != nil {
		t.Fatal(err)
	}
	c.SetReadLimit(-1)
	t.Cleanup(func() { c.CloseNow() })
	return c
}

func readMsg(t *testing.T, ctx context.Context, c *websocket.Conn) (*jsonv.Object, int, error) {
	t.Helper()
	_, data, err := c.Read(ctx)
	if err != nil {
		return nil, 0, err
	}
	v, err := jsonv.Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	return v.(*jsonv.Object), len(data), nil
}

func bigDoc(t *testing.T, s *Store, nodes, size int) {
	t.Helper()
	pad := strings.Repeat("x", size)
	var ops []any
	for i := range nodes {
		op, _ := jsonv.Parse([]byte(fmt.Sprintf(`{"op":"create","node":{"type":"rect","id":"t%d","name":"%s"}}`, i, pad)))
		ops = append(ops, op)
	}
	if _, err := s.Apply(ops, "user", "seed"); err != nil {
		t.Fatal(err)
	}
}

func TestSlowConsumerGetsLatestDocument(t *testing.T) {
	s, srv := startWS(t)
	bigDoc(t, s, 2500, 150)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	c := dialWS(t, ctx, srv, "")
	first, _, err := readMsg(t, ctx, c)
	if err != nil || first.Str("type") != "doc" {
		t.Fatalf("first frame: %v %v", first, err)
	}
	const writes = 120
	for i := range writes {
		op, _ := jsonv.Parse([]byte(fmt.Sprintf(`{"op":"update","id":"t0","props":{"opacity":%v}}`, 0.1+float64(i%8)/10)))
		if _, err := s.Apply([]any{op}, "agent:slow", "w"); err != nil {
			t.Fatal(err)
		}
	}
	want := s.Version()
	var last float64
	frames := 0
	for last < float64(want) {
		m, _, err := readMsg(t, ctx, c)
		if err != nil {
			t.Fatalf("consumer stuck on version %v of %d after %d frames: %v", last, want, frames, err)
		}
		if m.Str("type") == "doc" {
			frames++
			last = m.Num("version")
		}
	}
	t.Logf("frames after stall: %d for %d writes", frames, writes)
}

func TestNonDocMessagesKeepOrderUnderBackpressure(t *testing.T) {
	s, srv := startWS(t)
	bigDoc(t, s, 2500, 150)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	c := dialWS(t, ctx, srv, "")
	if m, _, err := readMsg(t, ctx, c); err != nil || m.Str("type") != "doc" {
		t.Fatalf("first frame: %v %v", m, err)
	}
	const n = 100
	for i := range n {
		s.Presence.Report("a", "agent:order", fmt.Sprintf("tool%d", i), nil)
		op, _ := jsonv.Parse([]byte(fmt.Sprintf(`{"op":"update","id":"t0","props":{"opacity":%v}}`, 0.1+float64(i%8)/10)))
		if _, err := s.Apply([]any{op}, "agent:order", "w"); err != nil {
			t.Fatal(err)
		}
	}
	next := 0
	var last float64
	want := s.Version()
	for next < n || last < float64(want) {
		m, _, err := readMsg(t, ctx, c)
		if err != nil {
			t.Fatalf("got %d of %d presence, version %v of %d: %v", next, n, last, want, err)
		}
		switch m.Str("type") {
		case "presence":
			if m.Str("actor") != "agent:order" {
				continue
			}
			if got := m.Str("tool"); got != fmt.Sprintf("tool%d", next) {
				t.Fatalf("presence out of order: got %s want tool%d", got, next)
			}
			next++
		case "doc":
			last = m.Num("version")
		}
	}
}

func TestBacklogOverflowClosesConnection(t *testing.T) {
	old := wsBacklogMessages
	wsBacklogMessages = 40
	defer func() { wsBacklogMessages = old }()
	s, srv := startWS(t)
	bigDoc(t, s, 2500, 150)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	c := dialWS(t, ctx, srv, "")
	if m, _, err := readMsg(t, ctx, c); err != nil || m.Str("type") != "doc" {
		t.Fatalf("first frame: %v %v", m, err)
	}
	for i := range 150 {
		s.Presence.Report("a", "agent:flood", fmt.Sprintf("tool%d", i), nil)
		op, _ := jsonv.Parse([]byte(fmt.Sprintf(`{"op":"update","id":"t0","props":{"opacity":%v}}`, 0.1+float64(i%8)/10)))
		if _, err := s.Apply([]any{op}, "agent:flood", "w"); err != nil {
			t.Fatal(err)
		}
	}
	rctx, rcancel := context.WithTimeout(ctx, 20*time.Second)
	defer rcancel()
	for {
		if _, _, err := readMsg(t, rctx, c); err != nil {
			if rctx.Err() != nil {
				t.Fatal("connection stayed open and silently dropped messages")
			}
			return
		}
	}
}

func TestOutboxCoalescesDocsAndKeepsOrder(t *testing.T) {
	closed := false
	o := newOutbox(func() { closed = true })
	o.push("a")
	o.pushDoc("d1", "w", 1)
	o.push("b")
	o.pushDoc("d2", "w", 2)
	o.pushDoc("d1-late", "w", 1)
	o.push("c")
	ctx := context.Background()
	var got []string
	for range 4 {
		m, ok := o.next(ctx)
		if !ok {
			t.Fatal("closed")
		}
		got = append(got, m)
	}
	if strings.Join(got, ",") != "a,d2,b,c" || closed {
		t.Fatalf("got %v closed=%v", got, closed)
	}
	o.pushDoc("other", "x", 1)
	if m, _ := o.next(ctx); m != "other" {
		t.Fatalf("other workspace: %s", m)
	}
}

func TestOutboxOverflowCloses(t *testing.T) {
	old := wsBacklogMessages
	wsBacklogMessages = 3
	defer func() { wsBacklogMessages = old }()
	closed := false
	o := newOutbox(func() { closed = true })
	for i := range 3 {
		if !o.push(fmt.Sprint(i)) {
			t.Fatal("early overflow")
		}
	}
	if o.push("x") || !closed {
		t.Fatal("overflow did not close")
	}
	if _, ok := o.next(context.Background()); ok {
		t.Fatal("closed outbox delivered")
	}
}

func TestInitialSnapshotIsSingleWhenViewArrives(t *testing.T) {
	s, srv := startWS(t)
	other, err := s.CreateWorkspace("Outro", "user")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c := dialWS(t, ctx, srv, "")
	c.Write(ctx, websocket.MessageText, []byte(`{"type":"view","workspaceId":"`+other.ID+`","reqId":"v1"}`))
	var docs []string
	for {
		m, _, err := readMsg(t, ctx, c)
		if err != nil {
			t.Fatal(err)
		}
		if m.Str("type") == "doc" {
			docs = append(docs, m.Obj("doc").Str("id"))
		}
		if m.Str("type") == "ack" {
			break
		}
	}
	time.Sleep(2 * wsInitialWait)
	rctx, rcancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer rcancel()
	for {
		m, _, err := readMsg(t, rctx, c)
		if err != nil {
			break
		}
		if m.Str("type") == "doc" {
			docs = append(docs, m.Obj("doc").Str("id"))
		}
	}
	if len(docs) != 1 || docs[0] != other.ID {
		t.Fatalf("snapshots on open: %v", docs)
	}
}

func TestInitialSnapshotStillSentWithoutView(t *testing.T) {
	_, srv := startWS(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	c := dialWS(t, ctx, srv, "")
	m, _, err := readMsg(t, ctx, c)
	if err != nil || m.Str("type") != "doc" || m.Str("kind") != "reload" {
		t.Fatalf("%v %v", m, err)
	}
}
