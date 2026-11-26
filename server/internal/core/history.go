package core

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

type HistoryEntry struct {
	Actor   string
	Label   string
	Ops     []any
	Inverse []any
	At      int64
	Batch   string
	Ord     int64
	Mark    int64
	By      string
	Keys    []string
	Wide    bool
}

type ConflictError struct {
	Step HistoryEntry
	With HistoryEntry
}

func (e *ConflictError) Error() string {
	return fmt.Sprintf("step %d (%s) cannot be applied alone: newer steps changed the same elements", e.Step.Ord, e.Step.Label)
}

var ErrNoStep = errors.New("no such step")

type Outcome struct {
	Entry HistoryEntry
	Done  bool
	Newer int
	Last  HistoryEntry
}

type History struct {
	current *Document
	undo    []HistoryEntry
	redo    []HistoryEntry
	limit   int
	open    bool
	settled bool
	scope   *ScopeIndex
	touched []string
	scoped  bool
	journal *Journal
	derived bool
	plain   bool
	legacy  bool
	saved   any
	counter int64
	Now     func() int64
}

func NewHistory(doc *Document) *History {
	return &History{current: doc, limit: 500, Now: func() int64 { return time.Now().UnixMilli() }}
}

func Restore(doc *Document, undo, redo []HistoryEntry) *History {
	h := NewHistory(doc)
	h.undo, h.redo = slices.Clone(undo), slices.Clone(redo)
	for _, e := range h.undo {
		h.counter = max(h.counter, e.Ord, e.Mark)
	}
	for _, e := range h.redo {
		h.counter = max(h.counter, e.Ord, e.Mark)
	}
	for i := range h.undo {
		if h.undo[i].Ord == 0 {
			h.counter++
			h.undo[i].Ord = h.counter
		}
	}
	for i := len(h.redo) - 1; i >= 0; i-- {
		if h.redo[i].Ord == 0 {
			h.counter++
			h.redo[i].Ord = h.counter
		}
	}
	for i := range h.redo {
		if h.redo[i].Mark == 0 {
			h.redo[i].Mark = h.counter
		}
	}
	for _, list := range [][]HistoryEntry{h.undo, h.redo} {
		for i := range list {
			if list[i].Keys == nil && !list[i].Wide && len(list[i].Inverse) > 0 {
				list[i].Keys, list[i].Wide = Footprint(list[i].Ops, list[i].Inverse, nil)
			}
		}
	}
	return h
}

func (h *History) Doc() *Document              { return h.current }
func (h *History) CanUndo() bool               { return len(h.undo) > 0 }
func (h *History) CanRedo() bool               { return len(h.redo) > 0 }
func (h *History) Entries() []HistoryEntry     { return h.undo }
func (h *History) RedoEntries() []HistoryEntry { return h.redo }

func (h *History) Persisted() any     { return h.saved }
func (h *History) SetPersisted(v any) { h.saved = v }

func (h *History) LastTouched() ([]string, bool) { return h.touched, h.scoped }

func (h *History) LastJournal() *Journal { return h.journal }

func (h *History) LastDerivedScoped() (scoped, plain bool) { return h.derived, h.plain }

func (h *History) run(ops []any) (*ApplyResult, error) {
	h.touched, h.scoped, h.journal, h.derived, h.plain = nil, false, nil, false, false
	if !h.legacy && !isShared(h.current) {
		jsonv.Freeze(h.current)
	}
	if h.settled {
		if h.scope == nil {
			h.scope = BuildScopeIndex(h.current)
		}
		if r, ok := ApplyScoped(h.current, ops, h.scope); ok {
			h.touched, h.scoped, h.journal = r.Touched, true, r.Journal
			return r, nil
		}
	}
	r, err := applyOps(h.current, ops, h.settled, h.scope)
	if err != nil {
		return nil, err
	}
	if len(ops) > 0 {
		h.settled = true
	}
	h.scope = r.Scope
	h.derived, h.plain = r.Derived, r.Scope != nil
	h.journal = r.Journal
	return r, nil
}

func (h *History) Apply(ops []any, actor, label string) (*ApplyResult, error) {
	return h.ApplyBatch(ops, actor, label, "")
}

func (h *History) ApplyBatch(ops []any, actor, label, batch string) (*ApplyResult, error) {
	r, err := h.run(ops)
	if err != nil {
		return nil, err
	}
	h.current = r.Doc
	keys, wide := Footprint(ops, r.Inverse, r.Doc)
	if n := len(h.undo); batch != "" && n > 0 && h.open && h.undo[n-1].Batch == batch && h.undo[n-1].Actor == actor {
		top := h.undo[n-1]
		top.Label = batch
		top.Ops = append(append([]any(nil), top.Ops...), ops...)
		top.Inverse = append(append([]any(nil), r.Inverse...), top.Inverse...)
		top.Keys, top.Wide = mergeKeys(top.Keys, keys), top.Wide || wide
		h.undo = append(h.undo[:n-1:n-1], top)
	} else {
		h.counter++
		h.undo = append(h.undo, HistoryEntry{Actor: actor, Label: label, Ops: ops, Inverse: r.Inverse, At: h.Now(), Batch: batch, Ord: h.counter, Keys: keys, Wide: wide})
		if len(h.undo) > h.limit {
			h.undo = h.undo[1:]
		}
	}
	h.open = true
	if len(h.redo) > 0 {
		h.redo = slices.DeleteFunc(slices.Clone(h.redo), func(e HistoryEntry) bool { return e.By == "" || e.By == actor })
		if len(h.redo) == 0 {
			h.redo = nil
		}
	}
	return r, nil
}

func (h *History) Undo() (HistoryEntry, bool, error) { return h.UndoBy("") }

func (h *History) Redo() (HistoryEntry, bool, error) { return h.RedoBy("") }

func (h *History) UndoBy(by string) (HistoryEntry, bool, error) {
	if len(h.undo) == 0 {
		return HistoryEntry{}, false, nil
	}
	out, err := h.undoAt(len(h.undo)-1, by)
	return out.Entry, out.Done, err
}

func (h *History) RedoBy(by string) (HistoryEntry, bool, error) {
	if len(h.redo) == 0 {
		return HistoryEntry{}, false, nil
	}
	out, err := h.redoAt(len(h.redo)-1, by)
	return out.Entry, out.Done, err
}

func (h *History) UndoOwn(actor string) (Outcome, error) {
	i := -1
	for j := len(h.undo) - 1; j >= 0; j-- {
		if h.undo[j].Actor == actor {
			i = j
			break
		}
	}
	if i < 0 {
		var last HistoryEntry
		if len(h.undo) > 0 {
			last = h.undo[len(h.undo)-1]
		}
		return Outcome{Last: last}, nil
	}
	return h.undoAt(i, actor)
}

func (h *History) UndoStep(ord int64, by string) (Outcome, error) {
	i := slices.IndexFunc(h.undo, func(e HistoryEntry) bool { return e.Ord == ord })
	if i < 0 {
		return Outcome{}, ErrNoStep
	}
	return h.undoAt(i, by)
}

func (h *History) RedoOwn(actor string) (Outcome, error) {
	for j := len(h.redo) - 1; j >= 0; j-- {
		if h.redo[j].By == actor {
			return h.redoAt(j, actor)
		}
	}
	return Outcome{}, nil
}

func (h *History) RedoStep(ord int64, by string) (Outcome, error) {
	j := slices.IndexFunc(h.redo, func(e HistoryEntry) bool { return e.Ord == ord })
	if j < 0 {
		return Outcome{}, ErrNoStep
	}
	return h.redoAt(j, by)
}

func (h *History) undoAt(i int, by string) (Outcome, error) {
	e := h.undo[i]
	later := h.undo[i+1:]
	for _, l := range later {
		if entriesConflict(e, l) {
			return Outcome{Entry: e}, &ConflictError{Step: e, With: l}
		}
	}
	r, err := h.run(e.Inverse)
	if err != nil {
		if len(later) > 0 {
			return Outcome{Entry: e}, &ConflictError{Step: e, With: later[len(later)-1]}
		}
		return Outcome{Entry: e}, err
	}
	h.open = false
	h.undo = slices.Concat(h.undo[:i:i], h.undo[i+1:])
	h.current = r.Doc
	e2 := e
	e2.Inverse = r.Inverse
	e2.Mark = h.counter
	e2.By = by
	keys, wide := Footprint(nil, r.Inverse, r.Doc)
	e2.Keys, e2.Wide = mergeKeys(e.Keys, keys), e.Wide || wide
	h.redo = append(h.redo, e2)
	if len(h.redo) > h.limit {
		h.redo = h.redo[1:]
	}
	return Outcome{Entry: e, Done: true, Newer: len(later)}, nil
}

func (h *History) redoAt(j int, by string) (Outcome, error) {
	e := h.redo[j]
	above := h.redo[j+1:]
	for _, a := range above {
		if entriesConflict(e, a) {
			return Outcome{Entry: e}, &ConflictError{Step: e, With: a}
		}
	}
	later := false
	for _, l := range h.undo {
		if l.Ord > e.Mark {
			later = true
			if entriesConflict(e, l) {
				return Outcome{Entry: e}, &ConflictError{Step: e, With: l}
			}
		}
	}
	r, err := h.run(e.Inverse)
	if err != nil {
		if len(above) > 0 || later {
			return Outcome{Entry: e}, &ConflictError{Step: e}
		}
		return Outcome{Entry: e}, err
	}
	h.open = false
	h.redo = slices.Concat(h.redo[:j:j], h.redo[j+1:])
	h.current = r.Doc
	e2 := e
	e2.Inverse = r.Inverse
	e2.Mark = 0
	e2.By = ""
	keys, wide := Footprint(nil, r.Inverse, r.Doc)
	e2.Keys, e2.Wide = mergeKeys(e.Keys, keys), e.Wide || wide
	h.undo = append(h.undo, e2)
	if len(h.undo) > h.limit {
		h.undo = h.undo[1:]
	}
	return Outcome{Entry: e, Done: true}, nil
}

func (h *History) Reset(doc *Document) {
	h.current = doc
	h.undo, h.redo = nil, nil
	h.counter = 0
	h.open = false
	h.settled, h.scope, h.touched, h.scoped, h.journal, h.saved = false, nil, nil, false, nil, nil
}
