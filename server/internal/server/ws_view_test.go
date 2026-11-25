package server

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func TestWebSocketViewDoesNotChangeActive(t *testing.T) {
	s, _ := openTemp(t)
	activeID := s.DocID()
	other, err := s.CreateWorkspace("Outro", "user")
	if err != nil {
		t.Fatal(err)
	}
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	dial := func() *websocket.Conn {
		t.Helper()
		c, _, err := websocket.Dial(ctx, strings.Replace(srv.URL, "http", "ws", 1)+"/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {srv.URL}}})
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	next := func(c *websocket.Conn, typ string) *jsonv.Object {
		t.Helper()
		for range 10 {
			_, data, err := c.Read(ctx)
			if err != nil {
				t.Fatal(err)
			}
			v, _ := jsonv.Parse(data)
			if m := v.(*jsonv.Object); m.Str("type") == typ {
				return m
			}
		}
		t.Fatalf("no %s message", typ)
		return nil
	}
	docID := func(m *jsonv.Object) string { return m.Obj("doc").Str("id") }
	has := func(id, node string) bool {
		t.Helper()
		h, err := s.ReadWorkspace(id)
		if err != nil {
			t.Fatal(err)
		}
		return core.Nodes(h.Doc).Has(node)
	}

	viewer, follower := dial(), dial()
	defer viewer.CloseNow()
	defer follower.CloseNow()
	next(viewer, "doc")
	next(follower, "doc")

	viewer.Write(ctx, websocket.MessageText, []byte(`{"type":"view","workspaceId":"`+other.ID+`","reqId":"v1"}`))
	if m := next(viewer, "doc"); docID(m) != other.ID {
		t.Fatalf("view sent %s, want %s", docID(m), other.ID)
	}
	if m := next(viewer, "ack"); m.Str("reqId") != "v1" {
		t.Fatalf("ack: %s", jsonv.Stringify(m, ""))
	}
	if s.DocID() != activeID {
		t.Fatal("view changed the active workspace")
	}

	viewer.Write(ctx, websocket.MessageText, []byte(`{"type":"ops","reqId":"r1","label":"criar","ops":[{"op":"create","node":{"type":"rect","id":"so-no-outro"}}]}`))
	if m := next(viewer, "doc"); docID(m) != other.ID || m.Str("actor") != "user" {
		t.Fatalf("edit echo: %s", jsonv.Stringify(m, ""))
	}
	next(viewer, "ack")
	if !has(other.ID, "so-no-outro") {
		t.Fatal("edit did not land in the viewed workspace")
	}
	if has(activeID, "so-no-outro") {
		t.Fatal("edit leaked into the active workspace")
	}

	op, _ := jsonv.Parse([]byte(`{"op":"create","node":{"type":"rect","id":"no-ativo"}}`))
	if _, err := s.Apply([]any{op}, "agent:x", "agente"); err != nil {
		t.Fatal(err)
	}
	if m := next(follower, "doc"); docID(m) != activeID {
		t.Fatalf("follower got %s", docID(m))
	}

	viewer.Write(ctx, websocket.MessageText, []byte(`{"type":"undo","reqId":"u1"}`))
	if m := next(viewer, "doc"); docID(m) != other.ID || m.Str("kind") != "undo" {
		t.Fatalf("undo echo: %s", jsonv.Stringify(m, ""))
	}
	if has(other.ID, "so-no-outro") {
		t.Fatal("undo did not remove the node from the viewed workspace")
	}

	viewer.Write(ctx, websocket.MessageText, []byte(`{"type":"view","workspaceId":"nope","reqId":"v2"}`))
	if m := next(viewer, "error"); m.Str("reqId") != "v2" || !strings.Contains(m.Str("message"), "nope") {
		t.Fatalf("unknown view: %s", jsonv.Stringify(m, ""))
	}
}
