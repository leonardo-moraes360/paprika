// Package server is the Go Paprika server: SQLite store, MCP (stdio and Streamable HTTP),
// WebSocket sync for the canvas, HTTP API and screenshots.
package server

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
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
	Kind    string // apply | undo | redo | reload | open | remote
	DocID   string // the workspace that changed
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
CREATE TABLE IF NOT EXISTS modes (
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name   TEXT NOT NULL,               -- theme mode (document.modes key)
  ord    INTEGER NOT NULL,            -- insertion order (JSON key order)
  tokens TEXT NOT NULL,               -- JSON object: the tokens this mode overrides
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
CREATE TABLE IF NOT EXISTS covers (
  doc_id     TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,           -- image/png, image/jpeg, image/webp or image/gif
  data       BLOB NOT NULL,
  updated_at INTEGER NOT NULL         -- Unix ms (cache-busting key of the cover URL)
);
CREATE TABLE IF NOT EXISTS workspace_ops (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,           -- Unix ms
  actor      TEXT NOT NULL,              -- "user" or the MCP agent name
  op         TEXT NOT NULL,              -- create | rename | open | delete
  doc_id     TEXT NOT NULL,
  doc_name   TEXT NOT NULL,              -- the name at the time of the operation
  detail     TEXT NOT NULL DEFAULT '{}'  -- JSON: for a delete, what went with it
);
CREATE INDEX IF NOT EXISTS workspace_ops_recent ON workspace_ops(seq DESC);
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
	CoverAt   int64  `json:"-"` // updated_at of its cover image, 0 = no cover
}

// ListDocuments lists the documents in a database (most recently updated first).
func ListDocuments(db *sql.DB) ([]DocInfo, error) {
	rows, err := db.Query(`SELECT d.id, d.name, d.version, d.updated_at, (SELECT COUNT(*) FROM nodes n WHERE n.doc_id = d.id),
		COALESCE((SELECT c.updated_at FROM covers c WHERE c.doc_id = d.id), 0)
		FROM documents d ORDER BY d.updated_at DESC, d.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DocInfo
	for rows.Next() {
		var d DocInfo
		if err := rows.Scan(&d.ID, &d.Name, &d.Version, &d.UpdatedAt, &d.Nodes, &d.CoverAt); err != nil {
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
	modes, err := loadModes(q, id)
	if err != nil {
		return nil, 0, err
	}
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
	raw := jsonv.NewObject("format", format, "id", id, "name", name, "tokens", tokens)
	if modes != nil {
		raw.Set("modes", modes)
	}
	raw.Set("rootIds", rootIDs)
	raw.Set("nodes", nodes)
	doc, err := core.ParseDocument(raw)
	if err != nil {
		return nil, 0, fmt.Errorf("documento %s inválido no banco: %w", id, err)
	}
	return doc, version, nil
}

// loadModes reads document.modes (nil when the document has none).
func loadModes(q querier, id string) (*jsonv.Object, error) {
	rows, err := q.Query(`SELECT name, tokens FROM modes WHERE doc_id = ? ORDER BY ord`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var modes *jsonv.Object
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		val, err := jsonv.Parse([]byte(v))
		if err != nil {
			return nil, err
		}
		if modes == nil {
			modes = jsonv.NewObject()
		}
		modes.Set(k, val)
	}
	return modes, rows.Err()
}

type querier interface {
	QueryRow(query string, args ...any) *sql.Row
	Query(query string, args ...any) (*sql.Rows, error)
	Exec(query string, args ...any) (sql.Result, error)
}

// writeDocument stores doc, writing only the nodes, tokens and modes that changed since prev (nil = all).
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
	if err := syncRows(tx, `modes`, id, core.Modes(doc), prevObj(prev, core.Modes), func(k string, v any, ord int) error {
		_, err := tx.Exec(`INSERT INTO modes(doc_id, name, ord, tokens) VALUES (?, ?, ?, ?)
			ON CONFLICT(doc_id, name) DO UPDATE SET ord = excluded.ord, tokens = excluded.tokens`, id, k, ord, jsonv.Stringify(v, ""))
		return err
	}, `DELETE FROM modes WHERE doc_id = ? AND name = ?`); err != nil {
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
		for _, q := range []string{
			`DELETE FROM nodes WHERE doc_id = ?`,
			`DELETE FROM tokens WHERE doc_id = ?`,
			`DELETE FROM modes WHERE doc_id = ?`,
			`DELETE FROM history WHERE doc_id = ?`,
		} {
			if _, err := tx.Exec(q, id); err != nil {
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

// tokenRef is a $token reference inside any string value (token chains included).
var tokenRef = regexp.MustCompile(`\$[A-Za-z0-9_.-]{1,100}`)

// ExportFrame builds a standalone `.paprika.json` from one frame (or group, or page): its
// subtree, the components its instances use, the tokens and theme modes those nodes reference
// (following `$token` chains), and the connectors whose ends all fit inside. A connector that
// points outside the kept set is dropped and reported in warnings; ids are kept, so importing
// the result on another server shows the same board.
func ExportFrame(db *sql.DB, docID, rootID string) (string, []string, error) {
	doc, _, err := LoadDocument(db, docID)
	if err != nil {
		return "", nil, err
	}
	root := core.GetNode(doc, rootID)
	if root == nil {
		return "", nil, fmt.Errorf(`o nó "%s" não existe no documento "%s"`, rootID, docID)
	}
	if t := root.Str("type"); t != "frame" && t != "group" && t != "page" {
		return "", nil, fmt.Errorf(`export --root precisa de um frame, group ou page; "%s" é %s`, rootID, t)
	}
	warnings := []string{}
	keep := map[string]bool{}
	var add func(id string)
	add = func(id string) {
		if keep[id] {
			return
		}
		n := core.GetNode(doc, id)
		if n == nil {
			return
		}
		keep[id] = true
		for _, c := range n.Strings("children") {
			add(c)
		}
		if src := n.Str("instanceOf"); src != "" {
			add(src)
		}
	}
	add(rootID)
	for _, id := range core.Nodes(doc).Keys() {
		if !keep[id] {
			continue
		}
		n := core.GetNode(doc, id)
		if n.Str("type") != "connector" {
			continue
		}
		var outside []string
		for _, end := range []string{"from", "to"} {
			if e := n.Obj(end); e != nil {
				if ref := e.Str("nodeId"); ref != "" && !keep[ref] {
					outside = append(outside, ref)
				}
			}
		}
		if len(outside) > 0 {
			delete(keep, id) // connectors are leaves: dropping one orphans nothing else
			warnings = append(warnings, fmt.Sprintf(`conector "%s" descartado: a ponta aponta para "%s", que está fora de "%s"`, id, strings.Join(outside, `", "`), rootID))
		}
	}
	// Tokens and theme modes the kept nodes reference, transitively.
	refs := map[string]bool{}
	neededModes := map[string]bool{}
	var scanStrings func(v any)
	scanStrings = func(v any) {
		switch t := v.(type) {
		case string:
			for _, m := range tokenRef.FindAllString(t, -1) {
				refs[m[1:]] = true
			}
		case *jsonv.Object:
			for _, k := range t.Keys() {
				child, _ := t.Get(k)
				scanStrings(child)
			}
		case []any:
			for _, x := range t {
				scanStrings(x)
			}
		}
	}
	tokens := jsonv.NewObject()
	src := core.Tokens(doc)
	for {
		for _, id := range core.Nodes(doc).Keys() {
			if !keep[id] {
				continue
			}
			n := core.GetNode(doc, id)
			scanStrings(n)
			if mode := n.Str("mode"); mode != "" {
				neededModes[mode] = true
			}
		}
		for m := range neededModes {
			if md := core.Modes(doc).Obj(m); md != nil {
				scanStrings(md)
			}
		}
		added := false
		for name := range refs {
			if !tokens.Has(name) {
				if v, ok := src.Get(name); ok {
					tokens.Set(name, jsonv.Clone(v))
					added = true
				}
			}
		}
		if !added {
			break
		}
		scanStrings(tokens)
	}
	nodes := jsonv.NewObject()
	for _, id := range core.Nodes(doc).Keys() {
		if !keep[id] {
			continue
		}
		n := jsonv.Clone(core.GetNode(doc, id)).(*jsonv.Object)
		if id == rootID {
			n.Set("parentId", nil)
		}
		if kids := n.Arr("children"); kids != nil {
			kept := []any{}
			for _, c := range kids {
				if s, ok := c.(string); ok && keep[s] {
					kept = append(kept, c)
				}
			}
			n.Set("children", kept)
		}
		nodes.Set(id, n)
	}
	name := root.Str("name")
	if name == "" {
		name = doc.Str("name")
	}
	// The export keeps the top level in the document's original order (component sources of
	// instances come along), so the imported outline matches the one the board left behind. A
	// root that was not top level (a frame inside another) is placed first.
	roots := []any{}
	rootWasTop := false
	for _, id := range doc.Strings("rootIds") {
		if keep[id] {
			roots = append(roots, id)
			if id == rootID {
				rootWasTop = true
			}
		}
	}
	if !rootWasTop {
		roots = append([]any{rootID}, roots...)
	}
	out := jsonv.NewObject(
		"format", doc.Str("format"),
		"id", core.NewID(),
		"name", name,
		"rootIds", roots,
		"nodes", nodes,
		"tokens", tokens,
	)
	var modesOut *jsonv.Object
	for m := range neededModes {
		if md := core.Modes(doc).Obj(m); md != nil {
			if modesOut == nil {
				modesOut = jsonv.NewObject()
			}
			modesOut.Set(m, jsonv.Clone(md))
		}
	}
	if modesOut != nil {
		out.Set("modes", modesOut)
	}
	if _, err := core.ParseDocument(out); err != nil {
		return "", warnings, fmt.Errorf("documento exportado inválido (bug?): %w", err)
	}
	return jsonv.Stringify(out, "  ") + "\n", warnings, nil
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
	aside       map[string]*wsLive
	dataVersion int64
	listeners   map[int]func(ChangeEvent)
	nextID      int
	errHandler  func(error)
	stop        chan struct{}
	stopOnce    sync.Once
	// Presence holds the agents' cursors for the canvas. Ephemeral: never written to SQLite.
	Presence *PresenceHub
	// deleteGrants are the short-lived tokens a second delete_workspace call must carry. Ephemeral on
	// purpose: a restart drops them, so the missing path fails closed (the caller gets a new summary).
	deleteGrants map[string]deleteGrant
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
	s := &Store{db: db, path: path, listeners: map[int]func(ChangeEvent){}, stop: make(chan struct{}), Presence: NewPresenceHub(nil)}
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

// wsLive is one workspace's document and undo history kept in this process.
type wsLive struct {
	history *core.History
	version int64
}

// WorkspaceHead names the workspace a read or write actually used.
type WorkspaceHead struct {
	ID      string
	Name    string
	Version int64
	Doc     *core.Document
	CanUndo bool
	CanRedo bool
}

func (s *Store) persistLocked(docID string, doc, prev *core.Document, version int64, undo, redo []core.HistoryEntry) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := writeDocument(tx, doc, prev, version, time.Now().UnixMilli()); err != nil {
		return err
	}
	if err := writeHistory(tx, docID, undo, redo); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	s.dataVersion = s.readDataVersion()
	return nil
}

func (s *Store) listenersLocked() []func(ChangeEvent) {
	ls := make([]func(ChangeEvent), 0, len(s.listeners))
	for _, fn := range s.listeners {
		ls = append(ls, fn)
	}
	return ls
}

func headOf(id string, live *wsLive) WorkspaceHead {
	d := live.history.Doc()
	return WorkspaceHead{ID: id, Name: d.Str("name"), Version: live.version, Doc: d, CanUndo: live.history.CanUndo(), CanRedo: live.history.CanRedo()}
}

func removedIDs(prev *core.Document, r *core.ApplyResult) {
	after := core.Nodes(r.Doc)
	for _, id := range core.Nodes(prev).Keys() {
		if !after.Has(id) {
			r.Removed = append(r.Removed, id)
		}
	}
}

// commit persists the new state; on failure the in-memory state is rolled back by the caller.
func (s *Store) commitLocked(prev *core.Document, actor, label, kind string) ([]func(ChangeEvent), ChangeEvent, error) {
	version := s.version + 1
	doc := s.history.Doc()
	if err := s.persistLocked(s.docID, doc, prev, version, s.history.Entries(), s.history.RedoEntries()); err != nil {
		return nil, ChangeEvent{}, err
	}
	s.version = version
	return s.listenersLocked(), ChangeEvent{doc, version, actor, label, kind, s.docID}, nil
}

func (s *Store) ensureAsideLocked(id string) (*wsLive, error) {
	var dbVersion int64
	err := s.db.QueryRow(`SELECT version FROM documents WHERE id = ?`, id).Scan(&dbVersion)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNoWorkspace
	}
	if err != nil {
		return nil, err
	}
	if s.aside == nil {
		s.aside = map[string]*wsLive{}
	}
	if live, ok := s.aside[id]; ok && live.version == dbVersion {
		return live, nil
	}
	doc, version, err := LoadDocument(s.db, id)
	if err != nil {
		return nil, err
	}
	undo, redo, err := loadHistory(s.db, id)
	if err != nil {
		return nil, err
	}
	live := &wsLive{history: core.Restore(doc, undo, redo), version: version}
	s.aside[id] = live
	return live, nil
}

func (s *Store) liveLocked(id string) (*wsLive, bool, error) {
	if id == "" || id == s.docID {
		return &wsLive{history: s.history, version: s.version}, false, nil
	}
	live, err := s.ensureAsideLocked(id)
	return live, true, err
}

// ReadWorkspace returns the document of id, or of the active workspace when id is empty.
// The active workspace is not switched.
func (s *Store) ReadWorkspace(id string) (WorkspaceHead, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	live, aside, err := s.liveLocked(id)
	if err != nil {
		return WorkspaceHead{}, err
	}
	target := id
	if !aside {
		target = s.docID
	}
	return headOf(target, live), nil
}

// WorkspaceChoiceError is the unknown-workspaceId error, naming the workspaces that do exist.
func (s *Store) WorkspaceChoiceError(id string) error {
	rows, err := s.db.Query(`SELECT id, name FROM documents ORDER BY updated_at DESC, id`)
	if err != nil {
		return fmt.Errorf("workspace %q does not exist (see list_workspaces)", id)
	}
	defer rows.Close()
	var parts []string
	for rows.Next() {
		var wid, name string
		if err := rows.Scan(&wid, &name); err != nil {
			return fmt.Errorf("workspace %q does not exist (see list_workspaces)", id)
		}
		parts = append(parts, fmt.Sprintf("%s %q", wid, name))
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("workspace %q does not exist (see list_workspaces)", id)
	}
	list := "(none)"
	if len(parts) > 0 {
		list = strings.Join(parts, ", ")
	}
	return fmt.Errorf("workspace %q does not exist. Workspaces: %s", id, list)
}

// ApplyIn runs a transaction on id, or on the active workspace when id is empty.
// Only a write to the active workspace is broadcast; another workspace keeps its own history
// and does not move the canvas.
func (s *Store) ApplyIn(id string, ops []any, actor, label, batch string) (*core.ApplyResult, WorkspaceHead, error) {
	s.mu.Lock()
	live, aside, err := s.liveLocked(id)
	if err != nil {
		s.mu.Unlock()
		return nil, WorkspaceHead{}, err
	}
	target := s.docID
	if aside {
		target = id
	}
	prevDoc := live.history.Doc()
	prevUndo := append([]core.HistoryEntry(nil), live.history.Entries()...)
	prevRedo := append([]core.HistoryEntry(nil), live.history.RedoEntries()...)
	r, err := live.history.ApplyBatch(ops, actor, label, batch)
	if err != nil {
		s.mu.Unlock()
		return nil, WorkspaceHead{}, err
	}
	version := live.version + 1
	if err := s.persistLocked(target, live.history.Doc(), prevDoc, version, live.history.Entries(), live.history.RedoEntries()); err != nil {
		restored := core.Restore(prevDoc, prevUndo, prevRedo)
		if aside {
			live.history = restored
		} else {
			s.history = restored
		}
		s.mu.Unlock()
		return nil, WorkspaceHead{}, fmt.Errorf("falha ao gravar no banco: %w", err)
	}
	live.version = version
	if !aside {
		s.history = live.history
		s.version = version
	}
	removedIDs(prevDoc, r)
	head := headOf(target, live)
	var ls []func(ChangeEvent)
	var ev ChangeEvent
	if !aside {
		ls = s.listenersLocked()
		ev = ChangeEvent{head.Doc, version, actor, label, "apply", target}
	}
	s.mu.Unlock()
	if !aside {
		emit(ls, ev)
	}
	return r, head, nil
}

// StepIn undoes or redoes one entry on id, or on the active workspace when id is empty.
func (s *Store) StepIn(id, actor string, redo bool) (bool, WorkspaceHead, error) {
	s.mu.Lock()
	live, aside, err := s.liveLocked(id)
	if err != nil {
		s.mu.Unlock()
		return false, WorkspaceHead{}, err
	}
	target := s.docID
	if aside {
		target = id
	}
	prevDoc := live.history.Doc()
	prevUndo := append([]core.HistoryEntry(nil), live.history.Entries()...)
	prevRedo := append([]core.HistoryEntry(nil), live.history.RedoEntries()...)
	var e core.HistoryEntry
	var ok bool
	kind, prefix := "undo", "desfazer"
	if redo {
		kind, prefix = "redo", "refazer"
		e, ok, err = live.history.Redo()
	} else {
		e, ok, err = live.history.Undo()
	}
	if err != nil || !ok {
		head := headOf(target, live)
		s.mu.Unlock()
		return false, head, err
	}
	version := live.version + 1
	what := e.Label
	if what == "" {
		what = e.Actor
	}
	if err := s.persistLocked(target, live.history.Doc(), prevDoc, version, live.history.Entries(), live.history.RedoEntries()); err != nil {
		restored := core.Restore(prevDoc, prevUndo, prevRedo)
		if aside {
			live.history = restored
		} else {
			s.history = restored
		}
		s.mu.Unlock()
		return false, WorkspaceHead{}, fmt.Errorf("falha ao gravar no banco: %w", err)
	}
	live.version = version
	if !aside {
		s.history = live.history
		s.version = version
	}
	head := headOf(target, live)
	var ls []func(ChangeEvent)
	var ev ChangeEvent
	if !aside {
		ls = s.listenersLocked()
		ev = ChangeEvent{head.Doc, version, actor, prefix + ": " + what, kind, target}
	}
	s.mu.Unlock()
	if !aside {
		emit(ls, ev)
	}
	return true, head, nil
}

// RecentHistoryIn returns the last limit undo entries of id, or of the active workspace when id is empty.
func (s *Store) RecentHistoryIn(id string, limit int) ([]HistorySummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	live, _, err := s.liveLocked(id)
	if err != nil {
		return nil, err
	}
	entries := live.history.Entries()
	if limit < len(entries) {
		entries = entries[len(entries)-limit:]
	}
	out := make([]HistorySummary, len(entries))
	for i, e := range entries {
		out[i] = HistorySummary{e.Actor, e.Label, e.At, len(e.Ops)}
	}
	return out, nil
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
	after := core.Nodes(r.Doc)
	for _, id := range core.Nodes(prevDoc).Keys() {
		if !after.Has(id) {
			r.Removed = append(r.Removed, id)
		}
	}
	s.mu.Unlock()
	emit(ls, ev)
	return r, nil
}

// RemoteResult is the outcome of ApplyRemote.
type RemoteResult struct {
	Ops     int      // operations computed
	Failed  []string // operations the core refused (applied one by one after the batch failed)
	Created bool     // the workspace did not exist and was created
}

// applyTolerant applies ops as one transaction; when the core refuses it, it applies them one by
// one and skips the ones that fail, so a merge the schema rejects heals as much as it can.
func applyTolerant(doc *core.Document, ops []any) (*core.Document, []string) {
	if r, err := core.ApplyOps(doc, ops); err == nil {
		return r.Doc, nil
	}
	var failed []string
	cur := doc
	for _, op := range ops {
		r, err := core.ApplyOps(cur, []any{op})
		if err != nil {
			failed = append(failed, err.Error())
			continue
		}
		cur = r.Doc
	}
	return cur, failed
}

// ApplyRemote applies changes that came from the team (ADR 0004) to workspace docID, which may be
// the active one, another one, or a new one (created with name). opsFor computes the operations
// against the current document under the store lock. The change goes through applyOps but not
// into the undo history: undo reverts local transactions only.
func (s *Store) ApplyRemote(docID, name, actor, label string, opsFor func(cur *core.Document) []any) (RemoteResult, error) {
	s.mu.Lock()
	if docID == s.docID {
		prev := s.history.Doc()
		ops := opsFor(prev)
		if len(ops) == 0 {
			s.mu.Unlock()
			return RemoteResult{}, nil
		}
		next, failed := applyTolerant(prev, ops)
		res := RemoteResult{Ops: len(ops), Failed: failed}
		if len(failed) == len(ops) {
			s.mu.Unlock()
			return res, nil
		}
		undo, redo := s.history.Entries(), s.history.RedoEntries()
		s.history = core.Restore(next, undo, redo)
		ls, ev, err := s.commitLocked(prev, actor, label, "remote")
		if err != nil {
			s.history = core.Restore(prev, undo, redo)
			s.mu.Unlock()
			return res, fmt.Errorf("falha ao gravar no banco: %w", err)
		}
		s.mu.Unlock()
		emit(ls, ev)
		return res, nil
	}
	defer s.mu.Unlock()
	res := RemoteResult{}
	doc, version, err := LoadDocument(s.db, docID)
	var prev *core.Document
	if err != nil {
		var exists int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE id = ?`, docID).Scan(&exists)
		if exists > 0 {
			return res, err
		}
		if name == "" {
			name = "Sem título"
		}
		doc, version, res.Created = core.CreateDocument(name, docID), 0, true
	} else {
		prev = doc
	}
	ops := opsFor(doc)
	res.Ops = len(ops)
	next := doc
	if len(ops) > 0 {
		next, res.Failed = applyTolerant(doc, ops)
	}
	if !res.Created && next == doc {
		return res, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return res, err
	}
	defer tx.Rollback()
	if err := writeDocument(tx, next, prev, version+1, time.Now().UnixMilli()); err != nil {
		return res, err
	}
	if err := tx.Commit(); err != nil {
		return res, err
	}
	s.dataVersion = s.readDataVersion()
	if live, ok := s.aside[docID]; ok {
		if live.version == version {
			undo, redo := live.history.Entries(), live.history.RedoEntries()
			live.history = core.Restore(next, undo, redo)
			live.version = version + 1
		} else {
			delete(s.aside, docID)
		}
	}
	return res, nil
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
	ev := ChangeEvent{s.history.Doc(), s.version, "db", "banco alterado por outro processo", "reload", s.docID}
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
// former TypeScript server, where the workspaces were the *.paprika.json files next to --file.
type WorkspaceInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Nodes     int    `json:"nodes"`
	UpdatedAt int64  `json:"updatedAt"`
	Active    bool   `json:"active"` // the document the canvas and the MCP tools read and write
	Cover     any    `json:"cover"`  // URL of the cover image (with a cache-busting ?v=), or nil: the card shows the first letter
}

func coverURL(id string, at int64) any {
	if at == 0 {
		return nil
	}
	return fmt.Sprintf("/api/workspaces/%s/cover?v=%d", url.PathEscape(id), at)
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
		out[i] = WorkspaceInfo{d.ID, d.Name, d.Nodes, d.UpdatedAt, d.ID == active, coverURL(d.ID, d.CoverAt)}
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

// WorkspaceOp is one entry of the workspace operations log: who did what to which document, when. It is
// not part of any document and not in any undo stack: a deleted workspace still leaves its delete entry,
// which is the point of keeping the list at all.
type WorkspaceOp struct {
	At      int64  `json:"at"`
	Actor   string `json:"actor"`
	Op      string `json:"op"` // create | rename | open | delete
	DocID   string `json:"workspaceId"`
	DocName string `json:"workspaceName"`
	Detail  any    `json:"detail"`
}

// MaxWorkspaceOps bounds one read of the log.
const MaxWorkspaceOps = 200

// logWorkspaceOp appends one entry. Best effort on purpose: the operation already happened, and an audit
// row that fails to write must not turn a completed delete into an error an agent would retry.
func (s *Store) logWorkspaceOp(actor, op, id, name string, detail any) {
	if detail == nil {
		detail = map[string]any{}
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		return
	}
	_, _ = s.db.Exec(`INSERT INTO workspace_ops(at, actor, op, doc_id, doc_name, detail) VALUES(?,?,?,?,?,?)`,
		time.Now().UnixMilli(), actor, op, id, name, string(encoded))
}

// ListWorkspaceOps reads the most recent workspace operations, newest first, optionally narrowed to one
// workspace. Entries stay after the workspace is deleted.
func (s *Store) ListWorkspaceOps(limit int, workspaceID string) ([]WorkspaceOp, error) {
	if limit <= 0 || limit > MaxWorkspaceOps {
		limit = 50
	}
	query := `SELECT at, actor, op, doc_id, doc_name, detail FROM workspace_ops`
	args := []any{}
	if workspaceID != "" {
		query += ` WHERE doc_id = ?`
		args = append(args, workspaceID)
	}
	query += ` ORDER BY seq DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WorkspaceOp{}
	for rows.Next() {
		var op WorkspaceOp
		var detail string
		if err := rows.Scan(&op.At, &op.Actor, &op.Op, &op.DocID, &op.DocName, &detail); err != nil {
			return nil, err
		}
		var parsed any
		if err := json.Unmarshal([]byte(detail), &parsed); err != nil {
			parsed = detail
		}
		op.Detail = parsed
		out = append(out, op)
	}
	return out, rows.Err()
}

// OpenWorkspace makes another document the active one: the canvas and the MCP tools switch to it
// (ChangeEvent with Kind "open"), with that document's own stored undo history.
func (s *Store) OpenWorkspace(id, actor string) (WorkspaceInfo, error) {
	info, err := s.workspaceInfo(id)
	if err != nil || info.Active {
		return info, err
	}
	s.mu.Lock()
	if id == s.docID {
		s.mu.Unlock()
		info.Active = true
		return info, nil
	}
	if s.aside == nil {
		s.aside = map[string]*wsLive{}
	}
	oldID := s.docID
	s.aside[oldID] = &wsLive{history: s.history, version: s.version}
	switched := false
	if live, ok := s.aside[id]; ok {
		var dbVersion int64
		qerr := s.db.QueryRow(`SELECT version FROM documents WHERE id = ?`, id).Scan(&dbVersion)
		if qerr == nil && live.version == dbVersion {
			delete(s.aside, id)
			s.docID = id
			s.history = live.history
			s.version = live.version
			s.dataVersion = s.readDataVersion()
			switched = true
		} else {
			delete(s.aside, id)
		}
	}
	if !switched {
		if err := s.load(id); err != nil {
			parked := s.aside[oldID]
			delete(s.aside, oldID)
			s.docID = oldID
			s.history = parked.history
			s.version = parked.version
			s.mu.Unlock()
			return WorkspaceInfo{}, err
		}
	}
	delete(s.aside, s.docID)
	ls := s.listenersLocked()
	doc := s.history.Doc()
	ev := ChangeEvent{doc, s.version, actor, "abrir workspace: " + doc.Str("name"), "open", s.docID}
	s.mu.Unlock()
	emit(ls, ev)
	s.logWorkspaceOp(actor, "open", id, info.Name, nil)
	info.Active = true
	return info, nil
}

// CreateWorkspace stores a new empty document (it does not become active). Blank name: "Sem título".
// actor is who asked: "user" from the HTTP API, the MCP agent name over MCP.
func (s *Store) CreateWorkspace(name, actor string) (WorkspaceInfo, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Sem título"
	}
	doc := core.CreateDocument(name, "")
	now := time.Now().UnixMilli()
	if err := writeDocument(s.db, doc, nil, 0, now); err != nil {
		return WorkspaceInfo{}, err
	}
	s.logWorkspaceOp(actor, "create", doc.Str("id"), name, nil)
	return WorkspaceInfo{doc.Str("id"), name, 0, now, false, nil}, nil
}

// ImportWorkspace stores a .paprika.json document as a new workspace without touching the
// active one: the human's canvas and every tool keep working where they were. The document is
// validated like a file load (core.ParseDocument); if its id already exists here the copy gets
// a new document id (node ids are kept).
func (s *Store) ImportWorkspace(input any, name, actor string) (WorkspaceInfo, error) {
	doc, err := core.ParseDocument(input)
	if err != nil {
		return WorkspaceInfo{}, fmt.Errorf("document: %w", err)
	}
	if n := strings.TrimSpace(name); n != "" {
		doc.Set("name", n)
	}
	id := doc.Str("id")
	var version int64
	err = s.db.QueryRow(`SELECT version FROM documents WHERE id = ?`, id).Scan(&version)
	switch {
	case err == nil:
		id = core.NewID()
		doc.Set("id", id)
	case !errors.Is(err, sql.ErrNoRows):
		return WorkspaceInfo{}, err
	}
	now := time.Now().UnixMilli()
	if err := writeDocument(s.db, doc, nil, 0, now); err != nil {
		return WorkspaceInfo{}, err
	}
	info, err := s.workspaceInfo(id)
	if err == nil {
		s.logWorkspaceOp(actor, "create", id, info.Name, map[string]any{"source": "import"})
	}
	return info, err
}

// ErrLastWorkspace is returned by DeleteWorkspace when the id is the only document: the server
// always has an active workspace.
var ErrLastWorkspace = errors.New("cannot delete the only workspace")

// RenameWorkspace changes a workspace's name (trimmed; blank is refused by the callers). The active
// one is renamed with a rename_document op, so the canvas follows and Ctrl+Z undoes it; another one
// is renamed with the same op applied to its stored document (no undo entry), with its version
// bumped so a process that has it open reloads it.
func (s *Store) RenameWorkspace(id, name, actor string) (WorkspaceInfo, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return WorkspaceInfo{}, errors.New("name must not be blank")
	}
	info, err := s.workspaceInfo(id)
	if err != nil {
		return info, err
	}
	if info.Name == name {
		return info, nil
	}
	if info.Active {
		if _, err := s.Apply([]any{jsonv.NewObject("op", "rename_document", "name", name)}, actor, "renomear workspace"); err != nil {
			return WorkspaceInfo{}, err
		}
		s.logWorkspaceOp(actor, "rename", id, name, map[string]any{"from": info.Name})
		return s.workspaceInfo(id)
	}
	// Same path as every other write (applyOps), outside the active history: no undo entry.
	tx, err := s.db.Begin()
	if err != nil {
		return WorkspaceInfo{}, err
	}
	defer tx.Rollback()
	doc, version, err := LoadDocument(tx, id)
	if err != nil {
		return WorkspaceInfo{}, ErrNoWorkspace
	}
	r, err := core.ApplyOps(doc, []any{jsonv.NewObject("op", "rename_document", "name", name)})
	if err != nil {
		return WorkspaceInfo{}, err
	}
	now := time.Now().UnixMilli()
	if err := writeDocument(tx, r.Doc, doc, version+1, now); err != nil {
		return WorkspaceInfo{}, err
	}
	if err := tx.Commit(); err != nil {
		return WorkspaceInfo{}, err
	}
	s.mu.Lock()
	delete(s.aside, id)
	s.mu.Unlock()
	s.logWorkspaceOp(actor, "rename", id, name, map[string]any{"from": info.Name})
	info.Name, info.UpdatedAt = name, now
	return info, nil
}

// WorkspaceDeletion is what deleting a workspace would take with it. An agent reads it, shows it to the
// human, and only then repeats the call with the token (see IssueDeleteConfirm).
type WorkspaceDeletion struct {
	ID             string `json:"workspaceId"`
	Name           string `json:"name"`
	Nodes          int    `json:"nodes"`
	Pages          int    `json:"pages"`
	Frames         int    `json:"frames"`
	Images         int    `json:"images"`
	Connectors     int    `json:"connectors"`
	HistoryEntries int    `json:"historyEntries"`
	HasCover       bool   `json:"hasCover"`
	Active         bool   `json:"active"`
	Successor      string `json:"successor,omitempty"`
	LastEditAt     int64  `json:"lastEditAt,omitempty"`
	LastEditBy     string `json:"lastEditBy,omitempty"`
	LastEditLabel  string `json:"lastEditLabel,omitempty"`
	Undoable       bool   `json:"undoable"` // always false here: no undo brings a deleted workspace back
}

// DescribeWorkspaceDeletion counts what a delete would remove. It reads stored rows only, so it describes
// a workspace that is not the active one as well; successor follows the same rule as DeleteWorkspace.
func (s *Store) DescribeWorkspaceDeletion(id string) (WorkspaceDeletion, error) {
	info, err := s.workspaceInfo(id)
	if err != nil {
		return WorkspaceDeletion{}, err
	}
	d := WorkspaceDeletion{ID: id, Name: info.Name, Active: info.Active, Successor: info.ID, Undoable: false}
	d.Successor = ""
	rows, err := s.db.Query(`SELECT type, COUNT(*) FROM nodes WHERE doc_id = ? GROUP BY type`, id)
	if err != nil {
		return d, err
	}
	defer rows.Close()
	for rows.Next() {
		var typ string
		var count int
		if err := rows.Scan(&typ, &count); err != nil {
			return d, err
		}
		d.Nodes += count
		switch typ {
		case "page":
			d.Pages += count
		case "frame":
			d.Frames += count
		case "image":
			d.Images += count
		case "connector":
			d.Connectors += count
		}
	}
	if err := rows.Err(); err != nil {
		return d, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM history WHERE doc_id = ? AND stack = 'undo'`, id).Scan(&d.HistoryEntries); err != nil {
		return d, err
	}
	var at int64
	var actor, label string
	err = s.db.QueryRow(`SELECT at, actor, label FROM history WHERE doc_id = ? AND stack = 'undo' ORDER BY seq DESC LIMIT 1`, id).Scan(&at, &actor, &label)
	switch {
	case err == nil:
		d.LastEditAt, d.LastEditBy, d.LastEditLabel = at, actor, label
	case !errors.Is(err, sql.ErrNoRows):
		return d, err
	}
	var coverAt int64
	err = s.db.QueryRow(`SELECT updated_at FROM covers WHERE doc_id = ?`, id).Scan(&coverAt)
	switch {
	case err == nil:
		d.HasCover = true
	case !errors.Is(err, sql.ErrNoRows):
		return d, err
	}
	for _, w := range mustList(s) {
		if w.ID != id {
			d.Successor = w.ID
			break
		}
	}
	return d, nil
}

// mustList is the successor lookup of DeleteWorkspace reused by the summary: the list is already ordered
// most recently updated first, and a read error leaves the successor empty (the delete path reports it).
func mustList(s *Store) []WorkspaceInfo {
	ws, err := s.ListWorkspaces()
	if err != nil {
		return nil
	}
	return ws
}

// DeleteConfirmTTL is how long a confirmToken lives. Short on purpose: the token exists to make the agent
// fetch and show the summary, not to be cached across a session.
const DeleteConfirmTTL = 2 * time.Minute

// ErrBadConfirmToken is a token that was never issued, was already spent, or belongs to another
// workspace; ErrExpiredConfirmToken is a token that timed out. Both mean "get a fresh summary".
var (
	ErrBadConfirmToken     = errors.New("confirmToken is not valid")
	ErrExpiredConfirmToken = errors.New("confirmToken has expired")
)

type deleteGrant struct {
	docID     string
	expiresAt int64
}

// IssueDeleteConfirm hands out the token the second delete_workspace call must carry, bound to the
// workspace id. Grants live in memory: a restart drops them, which fails closed.
func (s *Store) IssueDeleteConfirm(id string) (string, int64, error) {
	if _, err := s.workspaceInfo(id); err != nil {
		return "", 0, err
	}
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", 0, err
	}
	token := hex.EncodeToString(buf)
	now := time.Now().UnixMilli()
	ttl := DeleteConfirmTTL.Milliseconds()
	s.mu.Lock()
	if s.deleteGrants == nil {
		s.deleteGrants = map[string]deleteGrant{}
	}
	for spent, grant := range s.deleteGrants {
		if grant.expiresAt < now {
			delete(s.deleteGrants, spent)
		}
	}
	s.deleteGrants[token] = deleteGrant{docID: id, expiresAt: now + ttl}
	s.mu.Unlock()
	return token, ttl, nil
}

// ConsumeDeleteConfirm checks the token was issued for this workspace and spends it: one token deletes one
// workspace once, and reusing it is refused.
func (s *Store) ConsumeDeleteConfirm(id, token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	grant, ok := s.deleteGrants[token]
	if !ok || grant.docID != id {
		return ErrBadConfirmToken
	}
	delete(s.deleteGrants, token)
	if time.Now().UnixMilli() > grant.expiresAt {
		return ErrExpiredConfirmToken
	}
	return nil
}

// DeleteWorkspace removes a workspace with its nodes, tokens and history. Deleting the active one
// first opens the most recently updated other workspace (ChangeEvent "open"), so the canvas and the
// agents move there; the only workspace cannot be deleted (ErrLastWorkspace). Returns the id of
// the workspace that is active afterwards.
func (s *Store) DeleteWorkspace(id, actor string) (string, error) {
	ws, err := s.ListWorkspaces()
	if err != nil {
		return "", err
	}
	var target *WorkspaceInfo
	next := ""
	for i := range ws {
		if ws[i].ID == id {
			target = &ws[i]
		} else if next == "" {
			next = ws[i].ID // list is most recently updated first
		}
	}
	if target == nil {
		return "", ErrNoWorkspace
	}
	if next == "" {
		return "", ErrLastWorkspace
	}
	summary, err := s.DescribeWorkspaceDeletion(id)
	if err != nil {
		return "", err
	}
	summary.Successor = next
	if target.Active {
		if _, err := s.OpenWorkspace(next, actor); err != nil {
			return "", err
		}
	}
	// The cascade (foreign_keys=1) drops tokens, nodes and history with the document row.
	if _, err := s.db.Exec(`DELETE FROM documents WHERE id = ?`, id); err != nil {
		return "", err
	}
	s.mu.Lock()
	delete(s.aside, id)
	s.mu.Unlock()
	s.logWorkspaceOp(actor, "delete", id, target.Name, summary)
	return s.DocID(), nil
}

// MaxCoverBytes caps a workspace cover image (the card shows it at about 240×128).
const MaxCoverBytes = 2 * 1024 * 1024

// ErrBadCover is returned by SetCover for data that is not a PNG, JPEG, WebP or GIF, or is too big.
var ErrBadCover = errors.New("cover must be a PNG, JPEG, WebP or GIF image of at most 2 MiB")

// coverTypes are the image types a cover may have, detected from the bytes (never SVG: it would run
// as a document on the server's origin).
var coverTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true}

// SetCover stores (replaces) a workspace's cover image; the type is detected from the bytes. It is
// not part of the document: not in the undo history and not in exports.
func (s *Store) SetCover(id string, data []byte) (WorkspaceInfo, error) {
	mime := http.DetectContentType(data)
	if len(data) == 0 || len(data) > MaxCoverBytes || !coverTypes[mime] {
		return WorkspaceInfo{}, ErrBadCover
	}
	if _, err := s.workspaceInfo(id); err != nil {
		return WorkspaceInfo{}, err
	}
	now := time.Now().UnixMilli()
	if _, err := s.db.Exec(`INSERT INTO covers(doc_id, mime, data, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(doc_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`, id, mime, data, now); err != nil {
		return WorkspaceInfo{}, err
	}
	return s.workspaceInfo(id)
}

// ClearCover removes a workspace's cover (the card goes back to the first letter of the name).
func (s *Store) ClearCover(id string) (WorkspaceInfo, error) {
	if _, err := s.workspaceInfo(id); err != nil {
		return WorkspaceInfo{}, err
	}
	if _, err := s.db.Exec(`DELETE FROM covers WHERE doc_id = ?`, id); err != nil {
		return WorkspaceInfo{}, err
	}
	return s.workspaceInfo(id)
}

// Cover returns a workspace's cover image and its type; ErrNoWorkspace when it has none.
func (s *Store) Cover(id string) ([]byte, string, error) {
	var data []byte
	var mime string
	err := s.db.QueryRow(`SELECT data, mime FROM covers WHERE doc_id = ?`, id).Scan(&data, &mime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrNoWorkspace
	}
	return data, mime, err
}

// WorkspaceDocument loads a stored workspace's document (the active one comes from memory).
func (s *Store) WorkspaceDocument(id string) (*core.Document, error) {
	if id == s.DocID() {
		return s.Doc(), nil
	}
	if _, err := s.workspaceInfo(id); err != nil {
		return nil, err
	}
	doc, _, err := LoadDocument(s.db, id)
	return doc, err
}
