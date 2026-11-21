package core

import "time"

// HistoryEntry is one transaction in the shared undo history.
type HistoryEntry struct {
	Actor   string
	Label   string
	Ops     []any
	Inverse []any
	At      int64 // Unix milliseconds
}

// History holds undo/redo stacks over an immutable document. Agent and human share it.
type History struct {
	current *Document
	undo    []HistoryEntry
	redo    []HistoryEntry
	limit   int
	// Now is the clock (tests can freeze it).
	Now func() int64
}

// NewHistory starts a history at doc (limit 500 entries, like the TypeScript core).
func NewHistory(doc *Document) *History {
	return &History{current: doc, limit: 500, Now: func() int64 { return time.Now().UnixMilli() }}
}

// Restore rebuilds a history from persisted stacks.
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

// Apply runs a transaction and records it.
func (h *History) Apply(ops []any, actor, label string) (*ApplyResult, error) {
	r, err := ApplyOps(h.current, ops)
	if err != nil {
		return nil, err
	}
	h.current = r.Doc
	h.undo = append(h.undo, HistoryEntry{actor, label, ops, r.Inverse, h.Now()})
	if len(h.undo) > h.limit {
		h.undo = h.undo[1:]
	}
	h.redo = nil
	return r, nil
}

// Undo reverts the last transaction; ok=false when there is nothing to undo.
func (h *History) Undo() (HistoryEntry, bool, error) {
	if len(h.undo) == 0 {
		return HistoryEntry{}, false, nil
	}
	e := h.undo[len(h.undo)-1]
	r, err := ApplyOps(h.current, e.Inverse)
	if err != nil {
		return e, false, err
	}
	h.undo = h.undo[:len(h.undo)-1]
	h.current = r.Doc
	e2 := e
	e2.Inverse = r.Inverse
	h.redo = append(h.redo, e2)
	return e, true, nil
}

// Redo reapplies the last undone transaction.
func (h *History) Redo() (HistoryEntry, bool, error) {
	if len(h.redo) == 0 {
		return HistoryEntry{}, false, nil
	}
	e := h.redo[len(h.redo)-1]
	r, err := ApplyOps(h.current, e.Inverse)
	if err != nil {
		return e, false, err
	}
	h.redo = h.redo[:len(h.redo)-1]
	h.current = r.Doc
	e2 := e
	e2.Inverse = r.Inverse
	h.undo = append(h.undo, e2)
	return e, true, nil
}

// Reset replaces the document and clears the history.
func (h *History) Reset(doc *Document) {
	h.current = doc
	h.undo, h.redo = nil, nil
}
