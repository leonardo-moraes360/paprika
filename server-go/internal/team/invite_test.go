package team

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
)

func TestJoinByInviteThenSync(t *testing.T) {
	a, b := newInstance(t, "Ana"), newInstance(t, "Bruno")
	call(t, a, map[string]any{"t": "team.create", "name": "Estúdio Norte"})
	var inv struct {
		Link string `json:"link"`
	}
	_ = json.Unmarshal(call(t, a, map[string]any{"t": "invite.create", "ttlSecs": 600}), &inv)
	if !strings.HasPrefix(inv.Link, "paprika://join/") {
		t.Fatalf("link: %q", inv.Link)
	}
	call(t, b, map[string]any{"t": "join", "link": inv.Link})

	if _, err := a.store.Apply(ops(t, `[{"op":"create","node":{"type":"frame","id":"card","width":120,"height":80,"fill":"#ffffff"}}]`), "agent:claude-code", "card"); err != nil {
		t.Fatal(err)
	}
	if err := a.team.Share(""); err != nil {
		t.Fatal(err)
	}
	eventually(t, "B gets the shared workspace", func() bool { return core.GetNode(b.store.Doc(), "card") != nil })
	if _, err := a.store.Apply(ops(t, `[{"op":"update","id":"card","props":{"fill":"#e04a2b"}}]`), "agent:claude-code", "cor"); err != nil {
		t.Fatal(err)
	}
	eventually(t, "B gets the agent's edit", func() bool { return b.store.Doc().Obj("nodes").Obj("card").Str("fill") == "#e04a2b" })

	var st struct {
		Team struct {
			Name    string `json:"name"`
			Members []struct {
				Name   string   `json:"name"`
				Agents []string `json:"agents"`
			} `json:"members"`
		} `json:"team"`
	}
	eventually(t, "B sees Ana's agent in the team", func() bool {
		_ = json.Unmarshal(call(t, b, map[string]any{"t": "status"}), &st)
		for _, m := range st.Team.Members {
			if m.Name == "Ana" && len(m.Agents) == 1 && m.Agents[0] == "claude-code" {
				return true
			}
		}
		return false
	})
	if st.Team.Name != "Estúdio Norte" || len(st.Team.Members) != 2 {
		t.Fatalf("team on B: %+v", st.Team)
	}

	// The link was single use.
	c := newInstance(t, "Carla")
	ctx := t.Context()
	if _, err := c.team.Sidecar().Call(ctx, map[string]any{"t": "join", "link": inv.Link}); err == nil || !strings.Contains(err.Error(), "already used") {
		t.Fatalf("reused invite: %v", err)
	}
}

func TestRemoveMemberAndRotateKey(t *testing.T) {
	a, b, c := newInstance(t, "Ana"), newInstance(t, "Bruno"), newInstance(t, "Carla")
	call(t, a, map[string]any{"t": "team.create", "name": "T"})
	for _, who := range []*instance{b, c} {
		var inv struct {
			Link string `json:"link"`
		}
		_ = json.Unmarshal(call(t, a, map[string]any{"t": "invite.create", "ttlSecs": 600}), &inv)
		call(t, who, map[string]any{"t": "join", "link": inv.Link})
	}
	if err := a.team.Share(""); err != nil {
		t.Fatal(err)
	}
	if _, err := a.store.Apply(ops(t, `[{"op":"create","node":{"type":"frame","id":"card","width":120,"height":80,"fill":"#ffffff"}}]`), "user", "card"); err != nil {
		t.Fatal(err)
	}
	eventually(t, "B and C get the card", func() bool {
		return core.GetNode(b.store.Doc(), "card") != nil && core.GetNode(c.store.Doc(), "card") != nil
	})

	// The founder removes Bruno: his later edits reach nobody.
	call(t, a, map[string]any{"t": "member.remove", "key": b.team.Sidecar().ID})
	eventually(t, "B knows it left", func() bool {
		var st struct {
			Team struct{ Member bool } `json:"team"`
		}
		_ = json.Unmarshal(call(t, b, map[string]any{"t": "status"}), &st)
		return !st.Team.Member
	})
	if _, err := b.store.Apply(ops(t, `[{"op":"update","id":"card","props":{"fill":"#000000"}}]`), "user", "fora"); err != nil {
		t.Fatal(err)
	}

	// Carla rotates her key: the sidecar restarts with a new id and keeps syncing.
	old := c.team.Sidecar().ID
	res, err := c.team.RotateKey(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if c.team.Sidecar().ID == old || !strings.Contains(string(res), c.team.Sidecar().ID) {
		t.Fatalf("rotation: %s, id %s → %s", res, old, c.team.Sidecar().ID)
	}
	if _, err := c.store.Apply(ops(t, `[{"op":"update","id":"card","props":{"fill":"#e04a2b"}}]`), "user", "nova chave"); err != nil {
		t.Fatal(err)
	}
	eventually(t, "A gets Carla's edit signed by the new key", func() bool {
		return a.store.Doc().Obj("nodes").Obj("card").Str("fill") == "#e04a2b"
	})
	if a.store.Doc().Obj("nodes").Obj("card").Str("fill") == "#000000" || c.store.Doc().Obj("nodes").Obj("card").Str("fill") == "#000000" {
		t.Fatal("an edit of the removed member got in")
	}
}
