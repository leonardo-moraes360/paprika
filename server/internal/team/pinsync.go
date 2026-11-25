package team

import (
	"encoding/json"

	"github.com/leonardo-moraes360/paprika/server/internal/server"
)

type pinSnap struct {
	pins    map[string]string
	replies map[string]string
}

func (s *syncer) pinSnap(doc string) *pinSnap {
	if s.pinSnaps == nil {
		s.pinSnaps = map[string]*pinSnap{}
	}
	if s.pinSnaps[doc] == nil {
		s.pinSnaps[doc] = &pinSnap{pins: map[string]string{}, replies: map[string]string{}}
	}
	return s.pinSnaps[doc]
}

func snapFrom(pins []server.Pin) *pinSnap {
	out := &pinSnap{pins: map[string]string{}, replies: map[string]string{}}
	for _, p := range pins {
		out.pins[p.ID] = p.HeaderJSON()
		for _, r := range p.Replies {
			out.replies[r.ID] = r.SyncJSON(p.ID)
		}
	}
	return out
}

func (s *syncer) pushPins(doc string) {
	if !s.shared[doc] {
		return
	}
	cur, err := s.t.store.ExportPins(doc)
	if err != nil {
		s.t.log("sync: pins: " + err.Error())
		return
	}
	have := snapFrom(cur)
	snap := s.pinSnap(doc)
	var changes []any
	for id, js := range have.pins {
		if snap.pins[id] == js {
			continue
		}
		var v any
		if json.Unmarshal([]byte(js), &v) != nil {
			continue
		}
		changes = append(changes, map[string]any{"k": "pin", "id": id, "value": v})
	}
	for id, js := range have.replies {
		if snap.replies[id] == js {
			continue
		}
		var v any
		if json.Unmarshal([]byte(js), &v) != nil {
			continue
		}
		changes = append(changes, map[string]any{"k": "reply", "id": id, "value": v})
	}
	if len(changes) > 0 {
		if _, err := s.call(map[string]any{"t": "local", "doc": doc, "author": "user", "changes": changes}); err != nil {
			s.t.log("sync: pins: " + err.Error())
			return
		}
	}
	s.pinSnaps[doc] = have
}

func (s *syncer) pullPins(doc string, raw json.RawMessage) {
	var top map[string]json.RawMessage
	if json.Unmarshal(raw, &top) != nil {
		return
	}
	if _, ok := top["pins"]; !ok {
		return
	}
	var st struct {
		Pins    map[string]json.RawMessage `json:"pins"`
		Replies map[string]json.RawMessage `json:"replies"`
	}
	if json.Unmarshal(raw, &st) != nil {
		return
	}
	local, err := s.t.store.ExportPins(doc)
	if err != nil {
		s.t.log("sync: pins: " + err.Error())
		return
	}
	have := map[string]server.Pin{}
	for _, p := range local {
		have[p.ID] = p
	}
	snap := s.pinSnap(doc)
	repliesOf := map[string][]server.PinReply{}
	for id, rawReply := range st.Replies {
		var body struct {
			PinID     string `json:"pinId"`
			Author    string `json:"author"`
			Text      string `json:"text"`
			CreatedAt int64  `json:"createdAt"`
		}
		if json.Unmarshal(rawReply, &body) != nil || body.PinID == "" || id == "" {
			continue
		}
		repliesOf[body.PinID] = append(repliesOf[body.PinID], server.PinReply{ID: id, Author: body.Author, Text: body.Text, CreatedAt: body.CreatedAt})
	}
	for id, rawPin := range st.Pins {
		var h struct {
			N          int              `json:"n"`
			PageID     string           `json:"pageId"`
			NodeID     string           `json:"nodeId"`
			Region     server.PinRegion `json:"region"`
			Text       string           `json:"text"`
			Author     string           `json:"author"`
			Status     string           `json:"status"`
			ClaimedBy  string           `json:"claimedBy"`
			Reply      string           `json:"reply"`
			ResolvedBy string           `json:"resolvedBy"`
			CreatedAt  int64            `json:"createdAt"`
			UpdatedAt  int64            `json:"updatedAt"`
		}
		if json.Unmarshal(rawPin, &h) != nil || id == "" {
			continue
		}
		remote := server.Pin{
			ID: id, N: h.N, WorkspaceID: doc, PageID: h.PageID, NodeID: h.NodeID, Region: h.Region,
			Text: h.Text, Author: h.Author, Status: h.Status, ClaimedBy: h.ClaimedBy, Reply: h.Reply,
			ResolvedBy: h.ResolvedBy, CreatedAt: h.CreatedAt, UpdatedAt: h.UpdatedAt,
			Replies: repliesOf[id],
		}
		apply := remote
		keepLocal := false
		if cur, ok := have[id]; ok && cur.HeaderJSON() != remote.HeaderJSON() {
			if prev, seen := snap.pins[id]; seen && prev != cur.HeaderJSON() {
				keepLocal = true
			} else if cur.UpdatedAt > remote.UpdatedAt {
				keepLocal = true
			}
		}
		if keepLocal {
			apply = have[id]
			apply.Replies = repliesOf[id]
		}
		if err := s.t.store.ApplySyncedPin(doc, apply); err != nil {
			s.t.log("sync: pins: " + err.Error())
			continue
		}
		if !keepLocal {
			snap.pins[id] = remote.HeaderJSON()
		}
	}
	for id, list := range repliesOf {
		for _, r := range list {
			snap.replies[r.ID] = r.SyncJSON(id)
		}
	}
}

func (s *syncer) pullPinsFromSidecar(doc string) {
	raw, err := s.call(map[string]any{"t": "state", "doc": doc})
	if err != nil {
		return
	}
	s.pullPins(doc, raw)
}

func withPinState(store *server.Store, doc string, state json.RawMessage) any {
	var obj map[string]any
	if json.Unmarshal(state, &obj) != nil || obj == nil {
		obj = map[string]any{}
	}
	pins, replies := store.PinSyncMaps(doc)
	obj["pins"] = pins
	obj["replies"] = replies
	return obj
}
