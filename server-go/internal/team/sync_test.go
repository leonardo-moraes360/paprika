package team

import (
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	"github.com/leonardo-moraes360/paprika/server-go/internal/server"
)

func ops(t *testing.T, s string) []any {
	t.Helper()
	v, err := jsonv.Parse([]byte(s))
	if err != nil {
		t.Fatal(err)
	}
	return v.([]any)
}

func linked(t *testing.T) (*instance, *instance) {
	a, b := newInstance(t, "ana"), newInstance(t, "bruno")
	call(t, b, map[string]any{"t": "peer.add", "addr": a.team.Sidecar().Addr})
	call(t, a, map[string]any{"t": "peer.add", "addr": b.team.Sidecar().Addr})
	eventually(t, "connected", func() bool { s, _ := peerState(t, a); return s == "direct" })
	return a, b
}

func sameSynced(a, b *instance) bool { return synced(a.store.Doc()) == synced(b.store.Doc()) }

func TestWorkspaceSyncsBetweenTwoInstances(t *testing.T) {
	a, b := linked(t)
	if _, err := a.store.Apply(ops(t, base), "agent:claude-code", "base"); err != nil {
		t.Fatal(err)
	}
	if err := a.team.Share(""); err != nil {
		t.Fatal(err)
	}
	eventually(t, "B receives the shared workspace", func() bool { return sameSynced(a, b) })
	// Derived data is rebuilt on B by its own applyOps: instance copies and connector geometry.
	if core.GetNode(b.store.Doc(), core.CopyID("inst", "label")) == nil {
		t.Fatal("instance copy missing on B")
	}
	if b.store.Doc().Obj("nodes").Obj("c1").Str("d") == "" {
		t.Fatal("connector not routed on B")
	}
	if b.store.CanUndo() {
		t.Fatal("a remote change entered B's undo stack")
	}

	// A batch on B (two calls, one undo step) reaches A; B's undo reaches A as a forward change.
	if _, err := b.store.ApplyBatch(ops(t, `[{"op":"update","id":"r1","props":{"fill":"#00ff00"}}]`), "agent:codex", "pintar", "lote"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.store.ApplyBatch(ops(t, `[{"op":"update","id":"t1","props":{"text":"Olá"}}]`), "agent:codex", "texto", "lote"); err != nil {
		t.Fatal(err)
	}
	eventually(t, "A gets B's batch", func() bool {
		d := a.store.Doc().Obj("nodes")
		return d.Obj("r1").Str("fill") == "#00ff00" && d.Obj("t1").Str("text") == "Olá"
	})
	if ok, err := b.store.Undo("user"); err != nil || !ok {
		t.Fatalf("undo on B: %v %v", ok, err)
	}
	eventually(t, "A gets B's undo", func() bool {
		d := a.store.Doc().Obj("nodes")
		return d.Obj("r1").Str("fill") == "#f00" && d.Obj("t1").Str("text") == "Oi"
	})

	// Concurrent edits to different fields of one node: both survive, on both sides.
	if _, err := a.store.Apply(ops(t, `[{"op":"update","id":"r1","props":{"fill":"#abcdef"}}]`), "user", "a"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.store.Apply(ops(t, `[{"op":"update","id":"r1","props":{"name":"Card"}}]`), "user", "b"); err != nil {
		t.Fatal(err)
	}
	eventually(t, "concurrent edits converge", func() bool {
		r := a.store.Doc().Obj("nodes").Obj("r1")
		return sameSynced(a, b) && r.Str("fill") == "#abcdef" && r.Str("name") == "Card"
	})

	// Structure: B moves a node out of a frame and deletes the frame.
	if _, err := b.store.Apply(ops(t, `[{"op":"move","id":"e1","parentId":null},{"op":"delete","id":"f2"}]`), "user", "estrutura"); err != nil {
		t.Fatal(err)
	}
	eventually(t, "structure converges", func() bool {
		return sameSynced(a, b) && core.GetNode(a.store.Doc(), "f2") == nil && core.GetNode(a.store.Doc(), "e1") != nil
	})
}

func TestPinsReplicateBetweenTwoInstances(t *testing.T) {
	a, b := linked(t)
	if err := a.team.Share(""); err != nil {
		t.Fatal(err)
	}
	eventually(t, "B shares the workspace", func() bool {
		_, err := b.store.WorkspaceDocument(a.store.DocID())
		return err == nil
	})
	pin, err := a.store.CreatePin("", server.NewPin{Region: server.PinRegion{X: 1, Y: 2, Width: 30, Height: 10}, Text: "Aumente o título"}, "user")
	if err != nil {
		t.Fatal(err)
	}
	eventually(t, "B receives the pin", func() bool {
		pins, err := b.store.ListPins(server.PinFilter{Status: "all"})
		return err == nil && len(pins) == 1 && pins[0].Text == "Aumente o título" && pins[0].ID == pin.ID
	})
	if _, err := b.store.ReplyPin(pin.ID, "user", "Pode ser semibold?"); err != nil {
		t.Fatal(err)
	}
	eventually(t, "A receives the reply", func() bool {
		got, err := a.store.GetPin(pin.ID)
		return err == nil && len(got.Replies) == 1 && got.Replies[0].Text == "Pode ser semibold?"
	})
	if _, err := a.store.ResolvePin(pin.ID, "agent:claude-code", "Título em 32px"); err != nil {
		t.Fatal(err)
	}
	eventually(t, "B receives the resolve as a reply", func() bool {
		pins, err := b.store.ListPins(server.PinFilter{Status: "resolved"})
		if err != nil || len(pins) != 1 || pins[0].Status != "resolved" {
			return false
		}
		if len(pins[0].Replies) != 2 {
			return false
		}
		return pins[0].Replies[1].Author == "agent:claude-code" && pins[0].Replies[1].Text == "Título em 32px"
	})
}

func TestSharedWorkspaceIsCreatedOnThePeer(t *testing.T) {
	a, b := linked(t)
	info, err := a.store.CreateWorkspace("Landing", "user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.store.OpenWorkspace(info.ID, "user"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.store.Apply(ops(t, `[{"op":"create","node":{"type":"frame","id":"hero","width":100,"height":50}}]`), "user", "hero"); err != nil {
		t.Fatal(err)
	}
	if err := a.team.Share(info.ID); err != nil {
		t.Fatal(err)
	}
	eventually(t, "the workspace appears on B", func() bool {
		doc, err := b.store.WorkspaceDocument(info.ID)
		return err == nil && doc.Str("name") == "Landing" && core.GetNode(doc, "hero") != nil
	})
	// B opens it and edits; A (which has it open) follows.
	if _, err := b.store.OpenWorkspace(info.ID, "user"); err != nil {
		t.Fatal(err)
	}
	if _, err := b.store.Apply(ops(t, `[{"op":"update","id":"hero","props":{"fill":"#ff0000"}}]`), "user", "fill"); err != nil {
		t.Fatal(err)
	}
	eventually(t, "A follows B's edit", func() bool {
		return a.store.Doc().Obj("nodes").Obj("hero").Str("fill") == "#ff0000"
	})
}
