package core

import "time"

type HistoryEntry struct {
	Actor   string
	Label   string
	Ops     []any
	Inverse []any
	At      int64
	Batch   string
}

type History struct {
	current *Document
	undo    []HistoryEntry
	redo    []HistoryEntry
	limit   int
	open    bool
	Now     func() int64
}

func NewHistory(doc *Document) *History {
	return &History{current: doc, limit: 500, Now: func() int64 { return time.Now().UnixMilli() }}
}

func Restore(doc *Document, undo, redo []HistoryEntry) *History {
	h := NewHistory(doc)
	h.undo, h.redo = undo, redo
	return h
}

func (h *History) Doc() *Document              { return h.current }
func (h *History) CanUndo() bool               { return len(h.undo) > 0 }
func (h *History) CanRedo() bool               { return len(h.redo) > 0 }
func (h *History) Entries() []HistoryEntry     { return h.undo }
func (h *History) RedoEntries() []HistoryEntry { return h.redo }

func (h *History) Apply(ops []any, actor, label string) (*ApplyResult, error) {
	return h.ApplyBatch(ops, actor, label, "")
}

func (h *History) ApplyBatch(ops []any, actor, label, batch string) (*ApplyResult, error) {
	r, err := ApplyOps(h.current, ops)
	if err != nil {
		return nil, err
	}
	h.current = r.Doc
	if n := len(h.undo); batch != "" && n > 0 && h.open && h.undo[n-1].Batch == batch && h.undo[n-1].Actor == actor {
		top := h.undo[n-1]
		top.Label = batch
		top.Ops = append(append([]any(nil), top.Ops...), ops...)
		top.Inverse = append(append([]any(nil), r.Inverse...), top.Inverse...)
		h.undo = append(h.undo[:n-1:n-1], top)
	} else {
		h.undo = append(h.undo, HistoryEntry{actor, label, ops, r.Inverse, h.Now(), batch})
		if len(h.undo) > h.limit {
			h.undo = h.undo[1:]
		}
	}
	h.open = true
	h.redo = nil
	return r, nil
}

func (h *History) Undo() (HistoryEntry, bool, error) {
	if len(h.undo) == 0 {
		return HistoryEntry{}, false, nil
	}
	e := h.undo[len(h.undo)-1]
	r, err := ApplyOps(h.current, e.Inverse)
	if err != nil {
		return e, false, err
	}
	h.open = false
	h.undo = h.undo[:len(h.undo)-1]
	h.current = r.Doc
	e2 := e
	e2.Inverse = r.Inverse
	h.redo = append(h.redo, e2)
	return e, true, nil
}

func (h *History) Redo() (HistoryEntry, bool, error) {
	if len(h.redo) == 0 {
		return HistoryEntry{}, false, nil
	}
	e := h.redo[len(h.redo)-1]
	r, err := ApplyOps(h.current, e.Inverse)
	if err != nil {
		return e, false, err
	}
	h.open = false
	h.redo = h.redo[:len(h.redo)-1]
	h.current = r.Doc
	e2 := e
	e2.Inverse = r.Inverse
	h.undo = append(h.undo, e2)
	return e, true, nil
}

func (h *History) Reset(doc *Document) {
	h.current = doc
	h.undo, h.redo = nil, nil
	h.open = false
}
