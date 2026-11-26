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
	wsDeltaMessages   = 256
	wsDeltaBytes      = 2 << 20
)

type outItem struct {
	s       string
	doc     bool
	delta   bool
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
	dpending   int
	dbytes     int
	lastID     string
	lastVer    int64
	snapID     string
	snapVer    int64
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
	o.snapID, o.snapVer = id, version
	o.dropDeltasLocked(id, version)
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

func (o *outbox) hasDoc(id string, version int64) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.snapID == id && o.snapVer == version
}

func (o *outbox) dropDeltasLocked(id string, version int64) {
	if o.dpending == 0 {
		return
	}
	kept := o.items[:0]
	docAt := -1
	for i, it := range o.items {
		if it.delta && (it.id != id || it.version <= version) {
			o.dpending--
			o.dbytes -= len(it.s)
			continue
		}
		if i == o.docAt {
			docAt = len(kept)
		}
		kept = append(kept, it)
	}
	for i := len(kept); i < len(o.items); i++ {
		o.items[i] = outItem{}
	}
	o.items = kept
	o.docAt = docAt
}

func (o *outbox) pushDelta(s, id string, base, version int64) bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return true
	}
	if o.lastID == id && version <= o.lastVer {
		return true
	}
	if o.lastID == id && base != o.lastVer {
		return false
	}
	if o.dpending+1 > wsDeltaMessages || o.dbytes+len(s) > wsDeltaBytes {
		return false
	}
	o.lastID, o.lastVer = id, version
	o.items = append(o.items, outItem{s: s, delta: true, id: id, version: version})
	o.dpending++
	o.dbytes += len(s)
	o.signal()
	return true
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
			} else if it.delta {
				o.dpending--
				o.dbytes -= len(it.s)
				if o.docAt >= 0 {
					o.docAt--
				}
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

func (h *wsHub) broadcastEvent(match func(view string) bool, e ChangeEvent, undoRedo func() (bool, bool), snapshot func() string) {
	ts := h.targets(match)
	if len(ts) == 0 {
		return
	}
	var delta, snap string
	snapshotOnce := func() string {
		if snap == "" {
			snap = snapshot()
		}
		return snap
	}
	if e.Delta != nil {
		cu, cr := undoRedo()
		delta = deltaMessage(e, cu, cr)
	}
	for _, ob := range ts {
		if delta != "" && ob.pushDelta(delta, e.DocID, e.Base, e.Version) {
			continue
		}
		ob.pushDoc(snapshotOnce(), e.DocID, e.Version)
	}
}
