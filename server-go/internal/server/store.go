// Package server is the Go Paprika server: SQLite store, MCP (stdio and Streamable HTTP),
// WebSocket sync for the canvas, HTTP API and screenshots.
package server

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	_ "modernc.org/sqlite"
)

// ChangeEvent is emitted after every committed change.
type ChangeEvent struct {
	Doc     *core.Document
	Version int64
	Actor   string
	Label   string
	Kind    string // apply | undo | redo | reload
}

// HistorySummary is one row of get_history.
type HistorySummary struct {
	Actor string `json:"actor"`
	Label string `json:"label"`
	At    int64  `json:"at"`
	Ops   int    `json:"ops"`
}

const schemaSQL = `
CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  format     TEXT NOT NULL,
  name       TEXT NOT NULL,
  root_ids   TEXT NOT NULL,           -- JSON array
  version    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name   TEXT NOT NULL,
  ord    INTEGER NOT NULL,            -- insertion order (JSON key order)
  value  TEXT NOT NULL,               -- JSON string or number
  PRIMARY KEY (doc_id, name)
);
CREATE TABLE IF NOT EXISTS nodes (
  doc_id    TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  id        TEXT NOT NULL,
  ord       INTEGER NOT NULL,         -- insertion order of doc.nodes
  parent_id TEXT,
  type      TEXT NOT NULL,
  name      TEXT NOT NULL,
  data      TEXT NOT NULL,            -- the validated node as JSON
  PRIMARY KEY (doc_id, id)
);
CREATE INDEX IF NOT EXISTS nodes_parent ON nodes(doc_id, parent_id);
CREATE TABLE IF NOT EXISTS history (
  doc_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  stack   TEXT NOT NULL CHECK (stack IN ('undo', 'redo')),
  seq     INTEGER NOT NULL,
  actor   TEXT NOT NULL,
  label   TEXT NOT NULL,
  ops     TEXT NOT NULL,              -- JSON array of the original ops
  inverse TEXT NOT NULL,              -- JSON array of the ops that revert them
  at      INTEGER NOT NULL,           -- Unix ms
  PRIMARY KEY (doc_id, stack, seq)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '1');
`

// OpenDB opens (and migrates) a Paprika SQLite database.
func OpenDB(path string) (*sql.DB, error) {
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	dsn := "file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // one connection: serialized writes and a stable PRAGMA data_version
	if _, err := db.Exec(schemaSQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrando %s: %w", path, err)
	}
	return db, nil
}

// DocInfo describes a stored document.
type DocInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Nodes     int    `json:"nodes"`
	Version   int64  `json:"version"`
	UpdatedAt int64  `json:"updatedAt"`
}

// ListDocuments lists the documents in a database (most recently updated first).
func ListDocuments(db *sql.DB) ([]DocInfo, error) {
	rows, err := db.Query(`SELECT d.id, d.name, d.version, d.updated_at, (SELECT COUNT(*) FROM nodes n WHERE n.doc_id = d.id)
		FROM documents d ORDER BY d.updated_at DESC, d.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DocInfo
	for rows.Next() {
		var d DocInfo
		if err := rows.Scan(&d.ID, &d.Name, &d.Version, &d.UpdatedAt, &d.Nodes); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// LoadDocument reads a document back into its JSON form (same key order as when it was written).
func LoadDocument(q querier, id string) (*core.Document, int64, error) {
	var format, name, roots string
	var version int64
	err := q.QueryRow(`SELECT format, name, root_ids, version FROM documents WHERE id = ?`, id).Scan(&format, &name, &roots, &version)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, fmt.Errorf(`documento "%s" não existe no banco`, id)
	}
	if err != nil {
		return nil, 0, err
	}
	rootIDs, err := jsonv.Parse([]byte(roots))
	if err != nil {
		return nil, 0, err
	}
	tokens := jsonv.NewObject()
	rows, err := q.Query(`SELECT name, value FROM tokens WHERE doc_id = ? ORDER BY ord`, id)
	if err != nil {
		return nil, 0, err
	}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			rows.Close()
			return nil, 0, err
		}
		val, err := jsonv.Parse([]byte(v))
		if err != nil {
			rows.Close()
			return nil, 0, err
		}
		tokens.Set(k, val)
	}
	rows.Close()
	nodes := jsonv.NewObject()
	rows, err = q.Query(`SELECT id, data FROM nodes WHERE doc_id = ? ORDER BY ord`, id)
	if err != nil {
		return nil, 0, err
	}
	for rows.Next() {
		var nid, data string
		if err := rows.Scan(&nid, &data); err != nil {
			rows.Close()
			return nil, 0, err
		}
		n, err := jsonv.Parse([]byte(data))
		if err != nil {
			rows.Close()
			return nil, 0, err
		}
		nodes.Set(nid, n)
	}
	rows.Close()
	raw := jsonv.NewObject("format", format, "id", id, "name", name, "tokens", tokens, "rootIds", rootIDs, "nodes", nodes)
	doc, err := core.ParseDocument(raw)
	if err != nil {
		return nil, 0, fmt.Errorf("documento %s inválido no banco: %w", id, err)
	}
	return doc, version, nil
}

type querier interface {
	QueryRow(query string, args ...any) *sql.Row
	Query(query string, args ...any) (*sql.Rows, error)
	Exec(query string, args ...any) (sql.Result, error)
}

// writeDocument stores doc, writing only the nodes and tokens that changed since prev (nil = all).
func writeDocument(tx querier, doc, prev *core.Document, version int64, now int64) error {
	id := doc.Str("id")
	roots := jsonv.Stringify(doc.Arr("rootIds"), "")
	if _, err := tx.Exec(`INSERT INTO documents(id, format, name, root_ids, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET format = excluded.format, name = excluded.name, root_ids = excluded.root_ids,
		version = excluded.version, updated_at = excluded.updated_at`,
		id, doc.Str("format"), doc.Str("name"), roots, version, now, now); err != nil {
		return err
	}
	if err := syncRows(tx, `tokens`, id, core.Tokens(doc), prevObj(prev, core.Tokens), func(k string, v any, ord int) error {
		_, err := tx.Exec(`INSERT INTO tokens(doc_id, name, ord, value) VALUES (?, ?, ?, ?)
			ON CONFLICT(doc_id, name) DO UPDATE SET ord = excluded.ord, value = excluded.value`, id, k, ord, jsonv.Stringify(v, ""))
		return err
	}, `DELETE FROM tokens WHERE doc_id = ? AND name = ?`); err != nil {
		return err
	}
	return syncRows(tx, `nodes`, id, core.Nodes(doc), prevObj(prev, core.Nodes), func(k string, v any, ord int) error {
		n := v.(*core.Node)
		pid, _ := n.Get("parentId")
		_, err := tx.Exec(`INSERT INTO nodes(doc_id, id, ord, parent_id, type, name, data) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(doc_id, id) DO UPDATE SET ord = excluded.ord, parent_id = excluded.parent_id, type = excluded.type,
			name = excluded.name, data = excluded.data`, id, k, ord, pid, n.Str("type"), n.Str("name"), jsonv.Stringify(n, ""))
		return err
	}, `DELETE FROM nodes WHERE doc_id = ? AND id = ?`)
}

func prevObj(prev *core.Document, f func(*core.Document) *jsonv.Object) *jsonv.Object {
	if prev == nil {
		return nil
	}
	return f(prev)
}

// syncRows upserts entries that are new, changed or moved in key order, and deletes removed ones.
func syncRows(tx querier, _ string, docID string, cur, prev *jsonv.Object, upsert func(string, any, int) error, del string) error {
	prevOrd := map[string]int{}
	for i, k := range prev.Keys() {
		prevOrd[k] = i
	}
	for i, k := range cur.Keys() {
		v, _ := cur.Get(k)
		if po, ok := prevOrd[k]; ok && po == i {
			pv, _ := prev.Get(k)
			if pv == v || jsonv.Stringify(pv, "") == jsonv.Stringify(v, "") {
				continue
			}
		}
		if err := upsert(k, v, i); err != nil {
			return err
		}
	}
	if prev == nil {
		return nil
	}
	for _, k := range prev.Keys() {
		if !cur.Has(k) {
			if _, err := tx.Exec(del, docID, k); err != nil {
				return err
			}
		}
	}
	return nil
}

func loadHistory(q querier, docID string) (undo, redo []core.HistoryEntry, err error) {
	rows, err := q.Query(`SELECT stack, actor, label, ops, inverse, at FROM history WHERE doc_id = ? ORDER BY stack, seq`, docID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var stack, actor, label, ops, inv string
		var at int64
		if err := rows.Scan(&stack, &actor, &label, &ops, &inv, &at); err != nil {
			return nil, nil, err
		}
		o, err := jsonv.Parse([]byte(ops))
		if err != nil {
			return nil, nil, err
		}
		i, err := jsonv.Parse([]byte(inv))
		if err != nil {
			return nil, nil, err
		}
		e := core.HistoryEntry{Actor: actor, Label: label, Ops: o.([]any), Inverse: i.([]any), At: at}
		if stack == "undo" {
			undo = append(undo, e)
		} else {
			redo = append(redo, e)
		}
	}
	return undo, redo, rows.Err()
}

// writeHistory replaces the stored stacks with the in-memory ones (small: at most 500 + redo).
func writeHistory(tx querier, docID string, undo, redo []core.HistoryEntry) error {
	if _, err := tx.Exec(`DELETE FROM history WHERE doc_id = ?`, docID); err != nil {
		return err
	}
	for _, s := range []struct {
		name    string
		entries []core.HistoryEntry
	}{{"undo", undo}, {"redo", redo}} {
		for i, e := range s.entries {
			if _, err := tx.Exec(`INSERT INTO history(doc_id, stack, seq, actor, label, ops, inverse, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				docID, s.name, i, e.Actor, e.Label, jsonv.Stringify(e.Ops, ""), jsonv.Stringify(e.Inverse, ""), e.At); err != nil {
				return err
			}
		}
	}
	return nil
}

// ImportDocument validates a `.paprika.json` and stores it (history starts empty).
func ImportDocument(db *sql.DB, raw []byte, replace bool) (*core.Document, error) {
	v, err := jsonv.Parse(raw)
	if err != nil {
		return nil, err
	}
	doc, err := core.ParseDocument(v)
	if err != nil {
		return nil, err
	}
	id := doc.Str("id")
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var version int64
	err = tx.QueryRow(`SELECT version FROM documents WHERE id = ?`, id).Scan(&version)
	switch {
	case err == nil && !replace:
		return nil, fmt.Errorf(`documento "%s" já existe no banco (use --replace para sobrescrever)`, id)
	case err == nil:
		for _, t := range []string{"nodes", "tokens", "history"} {
			if _, err := tx.Exec(`DELETE FROM `+t+` WHERE doc_id = ?`, id); err != nil {
				return nil, err
			}
		}
		version++
	case !errors.Is(err, sql.ErrNoRows):
		return nil, err
	}
	if err := writeDocument(tx, doc, nil, version, time.Now().UnixMilli()); err != nil {
		return nil, err
	}
	return doc, tx.Commit()
}

// ExportDocument returns the document as `.paprika.json` text (JSON.stringify(doc, null, 2) + "\n").
func ExportDocument(db *sql.DB, id string) (string, error) {
	doc, _, err := LoadDocument(db, id)
	if err != nil {
		return "", err
	}
	return jsonv.Stringify(doc, "  ") + "\n", nil
}

// Store owns the active document in memory and in SQLite. Every mutation goes through
// core.History (applyOps), is committed to the database before it is acknowledged, and is
// broadcast as a ChangeEvent.
type Store struct {
	mu          sync.Mutex
	db          *sql.DB
	path        string
	docID       string
	history     *core.History
	version     int64
	dataVersion int64
	listeners   map[int]func(ChangeEvent)
	nextID      int
	errHandler  func(error)
	stop        chan struct{}
	stopOnce    sync.Once
}

// OpenOptions select the document of the database to serve.
type OpenOptions struct {
	DocID string // empty: the most recently updated document (one is created if the database is empty)
	Name  string // name for a newly created document
	// Poll is the interval to pick up commits from other processes (0 = default 300ms, <0 = off).
	Poll time.Duration
}

// OpenStore opens the database at path and loads the selected document.
func OpenStore(path string, opts OpenOptions) (*Store, error) {
	db, err := OpenDB(path)
	if err != nil {
		return nil, err
	}
	s := &Store{db: db, path: path, listeners: map[int]func(ChangeEvent){}, stop: make(chan struct{})}
	id := opts.DocID
	if id == "" {
		docs, err := ListDocuments(db)
		if err != nil {
			db.Close()
			return nil, err
		}
		if len(docs) > 0 {
			id = docs[0].ID
		}
	}
	if id == "" {
		name := opts.Name
		if name == "" {
			name = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
			if name == "" {
				name = "Sem título"
			}
		}
		doc := core.CreateDocument(name, "")
		if err := writeDocument(db, doc, nil, 0, time.Now().UnixMilli()); err != nil {
			db.Close()
			return nil, err
		}
		id = doc.Str("id")
	}
	if err := s.load(id); err != nil {
		db.Close()
		return nil, err
	}
	poll := opts.Poll
	if poll == 0 {
		poll = 300 * time.Millisecond
	}
	if poll > 0 {
		go s.watch(poll)
	}
	return s, nil
}

func (s *Store) load(id string) error {
	doc, version, err := LoadDocument(s.db, id)
	if err != nil {
		return err
	}
	undo, redo, err := loadHistory(s.db, id)
	if err != nil {
		return err
	}
	s.docID = id
	s.history = core.Restore(doc, undo, redo)
	s.version = version
	s.dataVersion = s.readDataVersion()
	return nil
}

func (s *Store) readDataVersion() int64 {
	var v int64
	_ = s.db.QueryRow(`PRAGMA data_version`).Scan(&v)
	return v
}

// Path is the database file.
func (s *Store) Path() string { return s.path }

// DB exposes the database (import/export from the HTTP API and tests).
func (s *Store) DB() *sql.DB { return s.db }

func (s *Store) DocID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.docID
}

// Doc returns the current document (treat as read-only).
func (s *Store) Doc() *core.Document {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.history.Doc()
}

func (s *Store) Version() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.version
}

// Snapshot returns doc, version, canUndo and canRedo consistently.
func (s *Store) Snapshot() (*core.Document, int64, bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.history.Doc(), s.version, s.history.CanUndo(), s.history.CanRedo()
}

func (s *Store) CanUndo() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.history.CanUndo()
}

func (s *Store) CanRedo() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.history.CanRedo()
}

// OnChange subscribes to change events; the returned function unsubscribes.
func (s *Store) OnChange(fn func(ChangeEvent)) func() {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := s.nextID
	s.nextID++
	s.listeners[id] = fn
	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.listeners, id)
	}
}

// OnError sets the handler for background errors (reload failures).
func (s *Store) OnError(fn func(error)) { s.errHandler = fn }

// RecentHistory returns the last `limit` undo entries.
func (s *Store) RecentHistory(limit int) []HistorySummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	entries := s.history.Entries()
	if limit < len(entries) {
		entries = entries[len(entries)-limit:]
	}
	out := make([]HistorySummary, len(entries))
	for i, e := range entries {
		out[i] = HistorySummary{e.Actor, e.Label, e.At, len(e.Ops)}
	}
	return out
}

// commit persists the new state; on failure the in-memory state is rolled back by the caller.
func (s *Store) commitLocked(prev *core.Document, actor, label, kind string) ([]func(ChangeEvent), ChangeEvent, error) {
	version := s.version + 1
	doc := s.history.Doc()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, ChangeEvent{}, err
	}
	defer tx.Rollback()
	if err := writeDocument(tx, doc, prev, version, time.Now().UnixMilli()); err != nil {
		return nil, ChangeEvent{}, err
	}
	if err := writeHistory(tx, s.docID, s.history.Entries(), s.history.RedoEntries()); err != nil {
		return nil, ChangeEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return nil, ChangeEvent{}, err
	}
	s.version = version
	s.dataVersion = s.readDataVersion()
	ls := make([]func(ChangeEvent), 0, len(s.listeners))
	for _, fn := range s.listeners {
		ls = append(ls, fn)
	}
	return ls, ChangeEvent{doc, version, actor, label, kind}, nil
}

func emit(ls []func(ChangeEvent), e ChangeEvent) {
	for _, fn := range ls {
		fn(e)
	}
}

// Apply runs a transaction; it returns only after the change is committed to SQLite.
func (s *Store) Apply(ops []any, actor, label string) (*core.ApplyResult, error) {
	return s.ApplyBatch(ops, actor, label, "")
}

// ApplyBatch is Apply with a batch name: consecutive writes of the same actor and batch share one
// undo entry (see core.History.ApplyBatch).
func (s *Store) ApplyBatch(ops []any, actor, label, batch string) (*core.ApplyResult, error) {
	s.mu.Lock()
	prevDoc := s.history.Doc()
	prevUndo, prevRedo := s.history.Entries(), s.history.RedoEntries()
	r, err := s.history.ApplyBatch(ops, actor, label, batch)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	ls, ev, err := s.commitLocked(prevDoc, actor, label, "apply")
	if err != nil {
		s.history = core.Restore(prevDoc, prevUndo, prevRedo)
		s.mu.Unlock()
		return nil, fmt.Errorf("falha ao gravar no banco: %w", err)
	}
	s.mu.Unlock()
	emit(ls, ev)
	return r, nil
}

func (s *Store) step(actor string, redo bool) (bool, error) {
	s.mu.Lock()
	prevDoc := s.history.Doc()
	prevUndo := append([]core.HistoryEntry(nil), s.history.Entries()...)
	prevRedo := append([]core.HistoryEntry(nil), s.history.RedoEntries()...)
	var e core.HistoryEntry
	var ok bool
	var err error
	kind, prefix := "undo", "desfazer"
	if redo {
		kind, prefix = "redo", "refazer"
		e, ok, err = s.history.Redo()
	} else {
		e, ok, err = s.history.Undo()
	}
	if err != nil || !ok {
		s.mu.Unlock()
		return false, err
	}
	what := e.Label
	if what == "" {
		what = e.Actor
	}
	ls, ev, err := s.commitLocked(prevDoc, actor, prefix+": "+what, kind)
	if err != nil {
		s.history = core.Restore(prevDoc, prevUndo, prevRedo)
		s.mu.Unlock()
		return false, fmt.Errorf("falha ao gravar no banco: %w", err)
	}
	s.mu.Unlock()
	emit(ls, ev)
	return true, nil
}

// Undo reverts the last transaction (from any author).
func (s *Store) Undo(actor string) (bool, error) { return s.step(actor, false) }

// Redo reapplies the last undone transaction.
func (s *Store) Redo(actor string) (bool, error) { return s.step(actor, true) }

// ReloadIfChanged picks up commits made by another process on the same database
// (e.g. `paprika mcp` over stdio next to `paprika serve`). History is reloaded too.
func (s *Store) ReloadIfChanged() (bool, error) {
	s.mu.Lock()
	dv := s.readDataVersion()
	if dv == s.dataVersion {
		s.mu.Unlock()
		return false, nil
	}
	s.dataVersion = dv
	var version int64
	if err := s.db.QueryRow(`SELECT version FROM documents WHERE id = ?`, s.docID).Scan(&version); err != nil || version == s.version {
		s.mu.Unlock()
		return false, nil
	}
	if err := s.load(s.docID); err != nil {
		s.mu.Unlock()
		return false, fmt.Errorf("ignorando alteração externa inválida em %s: %w", s.path, err)
	}
	ls := make([]func(ChangeEvent), 0, len(s.listeners))
	for _, fn := range s.listeners {
		ls = append(ls, fn)
	}
	ev := ChangeEvent{s.history.Doc(), s.version, "db", "banco alterado por outro processo", "reload"}
	s.mu.Unlock()
	emit(ls, ev)
	return true, nil
}

func (s *Store) watch(every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-t.C:
			if _, err := s.ReloadIfChanged(); err != nil && s.errHandler != nil {
				s.errHandler(err)
			}
		}
	}
}

// Close stops the watcher and closes the database.
func (s *Store) Close() error {
	s.stopOnce.Do(func() { close(s.stop) })
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.Close()
}

// WorkspaceInfo describes a workspace: one document of the database. Same keys and order as the
// TypeScript server, where the workspaces are the *.paprika.json files next to --file.
type WorkspaceInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Nodes     int    `json:"nodes"`
	UpdatedAt int64  `json:"updatedAt"`
	Active    bool   `json:"active"` // the document the canvas and the MCP tools read and write
}

// ErrNoWorkspace is returned by OpenWorkspace for an unknown id.
var ErrNoWorkspace = errors.New("workspace not found")

// ListWorkspaces lists the documents of the database, most recently updated first.
func (s *Store) ListWorkspaces() ([]WorkspaceInfo, error) {
	docs, err := ListDocuments(s.db)
	if err != nil {
		return nil, err
	}
	active := s.DocID()
	out := make([]WorkspaceInfo, len(docs))
	for i, d := range docs {
		out[i] = WorkspaceInfo{d.ID, d.Name, d.Nodes, d.UpdatedAt, d.ID == active}
	}
	return out, nil
}

func (s *Store) workspaceInfo(id string) (WorkspaceInfo, error) {
	ws, err := s.ListWorkspaces()
	if err != nil {
		return WorkspaceInfo{}, err
	}
	for _, w := range ws {
		if w.ID == id {
			return w, nil
		}
	}
	return WorkspaceInfo{}, ErrNoWorkspace
}

// OpenWorkspace makes another document the active one: the canvas and the MCP tools switch to it
// (ChangeEvent with Kind "open"), with that document's own stored undo history.
func (s *Store) OpenWorkspace(id, actor string) (WorkspaceInfo, error) {
	info, err := s.workspaceInfo(id)
	if err != nil || info.Active {
		return info, err
	}
	s.mu.Lock()
	if err := s.load(id); err != nil {
		s.mu.Unlock()
		return WorkspaceInfo{}, err
	}
	ls := make([]func(ChangeEvent), 0, len(s.listeners))
	for _, fn := range s.listeners {
		ls = append(ls, fn)
	}
	doc := s.history.Doc()
	ev := ChangeEvent{doc, s.version, actor, "abrir workspace: " + doc.Str("name"), "open"}
	s.mu.Unlock()
	emit(ls, ev)
	info.Active = true
	return info, nil
}

// CreateWorkspace stores a new empty document (it does not become active). Blank name: "Sem título".
func (s *Store) CreateWorkspace(name string) (WorkspaceInfo, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Sem título"
	}
	doc := core.CreateDocument(name, "")
	now := time.Now().UnixMilli()
	if err := writeDocument(s.db, doc, nil, 0, now); err != nil {
		return WorkspaceInfo{}, err
	}
	return WorkspaceInfo{doc.Str("id"), name, 0, now, false}, nil
}
