package server

import (
	"context"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func readUntil(t *testing.T, ctx context.Context, c *websocket.Conn, typ string) *jsonv.Object {
	t.Helper()
	for {
		m, _, err := readMsg(t, ctx, c)
		if err != nil {
			t.Fatal(err)
		}
		if m.Str("type") == typ {
			return m
		}
	}
}

func TestWSUndoByAuthorAckAndPanel(t *testing.T) {
	s, srv := startWS(t)
	if _, err := s.Apply(parseOps(t, authorSeed), "setup", "seed"); err != nil {
		t.Fatal(err)
	}
	fill(t, s, "user", "r1", "#111111")
	fill(t, s, "agent:claude", "r2", "#222222")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	c := dialWS(t, ctx, srv, "")
	readUntil(t, ctx, c, "doc")
	send := func(body string) {
		t.Helper()
		if err := c.Write(ctx, websocket.MessageText, []byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	send(`{"type":"undo","mode":"own","reqId":"a"}`)
	ack := readUntil(t, ctx, c, "ack")
	step := ack.Obj("step")
	if step == nil || step.Str("result") != "undone" || step.Str("label") != "fill r1" || step.Num("newer") != 1 {
		t.Fatalf("%v", jsonv.Stringify(ack, ""))
	}
	send(`{"type":"undo","mode":"own","reqId":"b"}`)
	if st := readUntil(t, ctx, c, "ack").Obj("step"); st.Str("result") != "nothing" || st.Str("actor") != "agent:claude" {
		t.Fatalf("%v", jsonv.Stringify(st, ""))
	}
	resp, err := http.Get(srv.URL + "/api/workspaces/" + s.DocID() + "/history")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	panel, err := jsonv.Parse(raw)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("%d %s", resp.StatusCode, raw)
	}
	steps := panel.(*jsonv.Object).Arr("steps")
	if len(steps) < 3 || !steps[len(steps)-2].(*jsonv.Object).Bool("undone") {
		t.Fatalf("%s", raw)
	}
	id := steps[len(steps)-2].(*jsonv.Object).Num("id")
	send(`{"type":"redo","mode":"step","step":` + jsonv.Stringify(id, "") + `,"reqId":"c"}`)
	if st := readUntil(t, ctx, c, "ack").Obj("step"); st.Str("result") != "redone" {
		t.Fatalf("%v", jsonv.Stringify(st, ""))
	}
	send(`{"type":"undo","mode":"step","step":99999,"reqId":"d"}`)
	if st := readUntil(t, ctx, c, "ack").Obj("step"); st.Str("result") != "missing" {
		t.Fatalf("%v", jsonv.Stringify(st, ""))
	}
}
