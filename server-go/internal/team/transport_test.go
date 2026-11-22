package team

import (
	"encoding/json"
	"strings"
	"testing"
)

func peerState(t *testing.T, i *instance) (state, name string) {
	var st struct {
		Peers []struct{ State, Name string } `json:"peers"`
	}
	_ = json.Unmarshal(call(t, i, map[string]any{"t": "status"}), &st)
	if len(st.Peers) == 0 {
		return "", ""
	}
	return st.Peers[0].State, st.Peers[0].Name
}

func TestTwoInstancesConnectAndSharePresence(t *testing.T) {
	a, b := newInstance(t, "ana"), newInstance(t, "bruno")
	call(t, b, map[string]any{"t": "peer.add", "addr": a.team.Sidecar().Addr})
	call(t, a, map[string]any{"t": "peer.add", "addr": b.team.Sidecar().Addr})
	eventually(t, "direct connection", func() bool {
		s, n := peerState(t, a)
		return s == "direct" && n == "bruno"
	})

	a.store.Presence.Report("s:abc", "agent:claude-code", "update_nodes", nil)
	eventually(t, "remote presence", func() bool {
		for _, p := range b.store.Presence.Recent() {
			if strings.HasPrefix(p.Agent, "peer:") && p.Actor == "agent:claude-code @ ana" && p.Tool == "update_nodes" {
				return true
			}
		}
		return false
	})
	// Presence that came from a peer is not echoed back.
	for _, p := range a.store.Presence.Recent() {
		if strings.HasPrefix(p.Agent, "peer:") {
			t.Fatalf("presence echoed back to its origin: %+v", p)
		}
	}
}
