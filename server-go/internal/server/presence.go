package server

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Agent presence: what each agent is doing right now (last tool and the nodes it touched), so the
// canvas can draw the agent's own cursor and selection. Ephemeral: memory only, never in SQLite or
// in the history. Port of packages/server/src/presence.ts.

// PresenceTTL is how long a presence is replayed to a canvas that connects later.
const PresenceTTL = 120 * time.Second

const (
	maxPresenceAgents = 64
	maxPresenceNodes  = 20
)

// Presence is one agent's last tool call.
type Presence struct {
	Agent string   // stable key: hash of the MCP session id over HTTP, or the actor (stdio)
	Actor string   // history actor ("agent:<clientInfo.name>")
	Tool  string   // last MCP tool called
	Nodes []string // nodes it acted on that still exist (created ones first)
	Idle  time.Duration
}

// Message is the WebSocket message ({type: "presence", agent, actor, tool, nodes, idle}).
func (p Presence) Message() string {
	nodes := make([]any, len(p.Nodes))
	for i, n := range p.Nodes {
		nodes[i] = n
	}
	return jsonv.Stringify(jsonv.NewObject("type", "presence", "agent", p.Agent, "actor", p.Actor, "tool", p.Tool,
		"nodes", nodes, "idle", float64(p.Idle.Milliseconds())), "")
}

// PresenceKey names an agent: its hashed HTTP session id, or the actor when there is none.
func PresenceKey(sessionID, actor string) string {
	if sessionID == "" {
		return actor
	}
	h := sha256.Sum256([]byte(sessionID))
	return "s:" + hex.EncodeToString(h[:])[:12]
}

func stringsOf(v any) []string {
	switch x := v.(type) {
	case string:
		return []string{x}
	case []any:
		out := make([]string, 0, len(x))
		for _, e := range x {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// PresenceTargets lists the nodes a tool call acted on: the ids it created (structuredContent.created)
// or, when it created nothing, the ids named in its arguments. Only existing ids, in order, once.
func PresenceTargets(args *jsonv.Object, structured *jsonv.Object, doc *core.Document) []string {
	out := []string{}
	nodes := core.Nodes(doc)
	add := func(ids []string) {
		for _, id := range ids {
			if len(out) >= maxPresenceNodes || !nodes.Has(id) {
				continue
			}
			dup := false
			for _, o := range out {
				dup = dup || o == id
			}
			if !dup {
				out = append(out, id)
			}
		}
	}
	if structured != nil {
		if v, ok := structured.Get("created"); ok {
			add(stringsOf(v))
		}
	}
	if len(out) > 0 || args == nil {
		return out
	}
	for _, k := range []string{"ids", "id", "rootId", "componentId", "within", "parentId"} {
		if v, ok := args.Get(k); ok {
			add(stringsOf(v))
		}
	}
	for _, list := range []string{"updates", "moves", "ops"} {
		for _, e := range args.Arr(list) {
			o, ok := e.(*jsonv.Object)
			if !ok {
				continue
			}
			for _, k := range []string{"id", "ids", "parentId"} {
				if v, ok := o.Get(k); ok {
					add(stringsOf(v))
				}
			}
		}
	}
	return out
}

type presenceEntry struct {
	Presence
	at time.Time
}

// PresenceHub keeps the last presence of each agent and fans it out to subscribers.
type PresenceHub struct {
	mu        sync.Mutex
	now       func() time.Time
	order     []string // agents, least recently reported first
	last      map[string]presenceEntry
	listeners map[int]func(Presence)
	nextID    int
}

// NewPresenceHub builds a hub; now is the clock (nil = time.Now).
func NewPresenceHub(now func() time.Time) *PresenceHub {
	if now == nil {
		now = time.Now
	}
	return &PresenceHub{now: now, last: map[string]presenceEntry{}, listeners: map[int]func(Presence){}}
}

// Report records an agent's tool call and broadcasts it (idle 0).
func (h *PresenceHub) Report(agent, actor, tool string, nodes []string) {
	p := Presence{Agent: agent, Actor: actor, Tool: tool, Nodes: nodes}
	h.mu.Lock()
	for i, a := range h.order {
		if a == agent {
			h.order = append(h.order[:i:i], h.order[i+1:]...)
			break
		}
	}
	h.order = append(h.order, agent)
	h.last[agent] = presenceEntry{p, h.now()}
	if len(h.order) > maxPresenceAgents {
		delete(h.last, h.order[0])
		h.order = h.order[1:]
	}
	ls := make([]func(Presence), 0, len(h.listeners))
	for _, fn := range h.listeners {
		ls = append(ls, fn)
	}
	h.mu.Unlock()
	for _, fn := range ls {
		fn(p)
	}
}

// Recent returns the presences younger than PresenceTTL, oldest first.
func (h *PresenceHub) Recent() []Presence {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()
	out := []Presence{}
	for _, a := range h.order {
		e := h.last[a]
		if idle := now.Sub(e.at); idle < PresenceTTL {
			p := e.Presence
			p.Idle = idle
			out = append(out, p)
		}
	}
	return out
}

// OnPresence subscribes to live presences; the returned function unsubscribes.
func (h *PresenceHub) OnPresence(fn func(Presence)) func() {
	h.mu.Lock()
	defer h.mu.Unlock()
	id := h.nextID
	h.nextID++
	h.listeners[id] = fn
	return func() {
		h.mu.Lock()
		delete(h.listeners, id)
		h.mu.Unlock()
	}
}
