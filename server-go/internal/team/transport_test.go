package team

import (
	"encoding/json"
	"strings"
	"testing"
)

func peerAddBoth(t *testing.T, a, b *instance) {
	t.Helper()
	call(t, b, map[string]any{"t": "peer.add", "addr": a.team.Sidecar().Addr})
	call(t, a, map[string]any{"t": "peer.add", "addr": b.team.Sidecar().Addr})
}

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

func teamStatus(t *testing.T, i *instance) map[string]any {
	t.Helper()
	var st map[string]any
	if err := json.Unmarshal(call(t, i, map[string]any{"t": "status"}), &st); err != nil {
		t.Fatal(err)
	}
	return st
}

func assertPeerPresence(t *testing.T, from, to *instance, actor, tool string) {
	t.Helper()
	from.store.Presence.Report("s:abc", "agent:claude-code", tool, nil)
	want := actor
	eventually(t, "remote presence", func() bool {
		for _, p := range to.store.Presence.Recent() {
			if strings.HasPrefix(p.Agent, "peer:") && p.Actor == want && (tool == "" || p.Tool == tool) {
				return true
			}
		}
		return false
	})
}

func TestTwoInstancesConnectAndSharePresence(t *testing.T) {
	a, b := newInstance(t, "ana"), newInstance(t, "bruno")
	peerAddBoth(t, a, b)
	eventually(t, "direct connection", func() bool {
		s, n := peerState(t, a)
		return s == "direct" && n == "bruno"
	})
	st := teamStatus(t, a)
	if st["app"] == nil || st["format"] != "paprika/1" {
		t.Fatalf("local versions missing in status: app=%v format=%v", st["app"], st["format"])
	}
	peers, _ := st["peers"].([]any)
	peer0, _ := peers[0].(map[string]any)
	if peer0["app"] == nil || peer0["format"] != "paprika/1" {
		t.Fatalf("peer versions missing in status: %+v", peer0)
	}

	assertPeerPresence(t, a, b, "agent:claude-code @ ana", "update_nodes")
	for _, p := range a.store.Presence.Recent() {
		if strings.HasPrefix(p.Agent, "peer:") {
			t.Fatalf("presence echoed back to its origin: %+v", p)
		}
	}
}

func TestIncompatibleFormatRefusedOnBothSides(t *testing.T) {
	a := newInstanceVersions(t, "ana", "0.0.1", "paprika/1")
	b := newInstanceVersions(t, "bruno", "0.0.1", "paprika/0")
	peerAddBoth(t, a, b)
	eventually(t, "A refuses incompatible format", func() bool {
		return a.logs.has("incompatible document format")
	})
	eventually(t, "B refuses incompatible format", func() bool {
		return b.logs.has("incompatible document format")
	})
	eventually(t, "no lasting sync connection", func() bool {
		as, _ := peerState(t, a)
		bs, _ := peerState(t, b)
		return as != "direct" && as != "relay" && bs != "direct" && bs != "relay"
	})
}

func TestDifferentAppVersionSyncsWithWarning(t *testing.T) {
	a := newInstanceVersions(t, "ana", "0.0.1", "paprika/1")
	b := newInstanceVersions(t, "bruno", "9.9.9", "paprika/1")
	peerAddBoth(t, a, b)
	eventually(t, "direct connection despite different app", func() bool {
		s, _ := peerState(t, a)
		return s == "direct"
	})
	eventually(t, "A warns about peer app", func() bool {
		return a.logs.has("9.9.9") && a.logs.has("Sync continues")
	})
	eventually(t, "B warns about peer app", func() bool {
		return b.logs.has("0.0.1") && b.logs.has("Sync continues")
	})
	st := teamStatus(t, a)
	peers, _ := st["peers"].([]any)
	peer0, _ := peers[0].(map[string]any)
	if peer0["app"] != "9.9.9" || peer0["format"] != "paprika/1" {
		t.Fatalf("peer versions in status: %+v", peer0)
	}
	assertPeerPresence(t, a, b, "agent:claude-code @ ana", "")
}
