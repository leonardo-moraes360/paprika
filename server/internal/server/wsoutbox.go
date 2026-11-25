package server

import (
	"context"
	"sync"
	"time"
)

var (
	wsBacklogMessages = 4096
	wsBacklogBytes    = 16 << 20
	wsInitialWait     = 150 * time.Millisecond
)

type outItem struct {
	s       string
	doc     bool
	id      string
	version int64
}

type outbox struct {
	mu         sync.Mutex
	items      []outItem
	docAt      int
	held       bool
	closed     bool
	pending    int
	bytes      int
	lastID     string
	lastVer    int64
	wake       chan struct{}
	onOverflow func()
}

func newOutbox(onOverflow func()) *outbox {
	return &outbox{docAt: -1, wake: make(chan struct{}, 1), onOverflow: onOverflow}
}

func (o *outbox) signal() {
	select {
	case o.wake <- struct{}{}:
	default:
	}
}

func (o *outbox) reserveDoc() {
	o.mu.Lock()
	o.held = true
	o.items = append([]outItem{{doc: true}}, o.items...)
	o.docAt = 0
	o.mu.Unlock()
}

func (o *outbox) docEmpty() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.docAt >= 0 && o.items[o.docAt].s == ""
}

func (o *outbox) release() {
	o.mu.Lock()
	o.held = false
	o.mu.Unlock()
	o.signal()
}

func (o *outbox) push(s string) bool {
	o.mu.Lock()
	if o.closed {
		o.mu.Unlock()
		return false
	}
	if o.pending+1 > wsBacklogMessages || o.bytes+len(s) > wsBacklogBytes {
		o.closed = true
		o.items = nil
		o.docAt = -1
		o.mu.Unlock()
		o.signal()
		if o.onOverflow != nil {
			o.onOverflow()
		}
		return false
	}
	o.items = append(o.items, outItem{s: s})
	o.pending++
	o.bytes += len(s)
	o.mu.Unlock()
	o.signal()
	return true
}

func (o *outbox) pushDoc(s, id string, version int64) {
	o.mu.Lock()
	if o.closed || (o.lastID == id && version < o.lastVer) {
		o.mu.Unlock()
		return
	}
	o.lastID, o.lastVer = id, version
	it := outItem{s: s, doc: true, id: id, version: version}
	if o.docAt >= 0 {
		o.items[o.docAt] = it
	} else {
		o.items = append(o.items, it)
		o.docAt = len(o.items) - 1
	}
	o.mu.Unlock()
	o.signal()
}

func (o *outbox) next(ctx context.Context) (string, bool) {
	for {
		o.mu.Lock()
		if o.closed {
			o.mu.Unlock()
			return "", false
		}
		if !o.held && len(o.items) > 0 && o.items[0].s != "" {
			it := o.items[0]
			o.items[0] = outItem{}
			o.items = o.items[1:]
			if it.doc {
				o.docAt = -1
			} else {
				o.pending--
				o.bytes -= len(it.s)
				if o.docAt >= 0 {
					o.docAt--
				}
			}
			if len(o.items) > 0 {
				o.signal()
			}
			o.mu.Unlock()
			return it.s, true
		}
		o.mu.Unlock()
		select {
		case <-o.wake:
		case <-ctx.Done():
			return "", false
		}
	}
}

func (h *wsHub) targets(match func(view string) bool) []*outbox {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []*outbox
	for c, ob := range h.conns {
		if match == nil || match(h.view[c]) {
			out = append(out, ob)
		}
	}
	return out
}

func (h *wsHub) broadcast(msg string) {
	for _, ob := range h.targets(nil) {
		ob.push(msg)
	}
}

func (h *wsHub) broadcastDoc(match func(view string) bool, build func() (msg, id string, version int64)) {
	ts := h.targets(match)
	if len(ts) == 0 {
		return
	}
	msg, id, version := build()
	for _, ob := range ts {
		ob.pushDoc(msg, id, version)
	}
}
