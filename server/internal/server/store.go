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

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
	_ "modernc.org/sqlite"
)

type ChangeEvent struct {
	Doc     *core.Document
	Version int64
	Actor   string
	Label   string
	Kind    string
	DocID   string
	Base    int64
	Delta   *docDelta
}

type AsideEvent struct {
	ChangeEvent
	CanUndo, CanRedo bool
}

type HistorySummary struct {
	Actor string `json:"actor"`
	Label string `json:"label"`
	At    int64  `json:"at"`
	Ops   int    `json:"ops"`
}

type HistoryStep struct {
	Kind  string `json:"kind"`
	Actor string `json:"actor"`
	At    int64  `json:"at"`
	Label string `json:"label"`
}

type HistoryView struct {
	Entries []HistorySummary
	Redo    []HistorySummary
	Steps   []HistoryStep
	CanUndo bool
	CanRedo bool
}

const maxHistorySteps = 500

const schemaSQL = `
CREATE TABLE IF NOT EXISTS documents (
  id         TEXT PRIMARY KEY,
  format     TEXT NOT NULL,
  name       TEXT NOT NULL,
  root_ids   TEXT NOT NULL,           -- JSON array
  version    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived   INTEGER NOT NULL DEFAULT 0, -- 1: hidden from the overview and list_workspaces
  folder_id  TEXT NOT NULL DEFAULT ''    -- overview folder, empty = root
);
CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
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
CREATE TABLE IF NOT EXISTS token_meta (
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name   TEXT NOT NULL,
  ord    INTEGER NOT NULL,            -- insertion order of document.tokenMeta
  meta   TEXT NOT NULL,               -- JSON object: type and collection
  PRIMARY KEY (doc_id, name)
);
CREATE TABLE IF NOT EXISTS assets (
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name   TEXT NOT NULL,
  ord    INTEGER NOT NULL,            -- insertion order of document.assets
  src    TEXT NOT NULL,               -- the asset data URI
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
CREATE TABLE IF NOT EXISTS history_steps (
  seq    INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind   TEXT NOT NULL CHECK (kind IN ('undo', 'redo')),
  actor  TEXT NOT NULL,              -- "user" (canvas) or the MCP agent name
  label  TEXT NOT NULL,              -- label of the transaction that was moved
  at     INTEGER NOT NULL            -- Unix ms
);
CREATE INDEX IF NOT EXISTS history_steps_doc ON history_steps(doc_id, seq DESC);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '3');
`

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
	db.SetMaxOpenConns(1)
	if err := migrateDB(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrando %s: %w", path, err)
	}
	if _, err := db.Exec(pinsSQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrando %s: %w", path, err)
	}
	return db, nil
}

func migrateDB(db *sql.DB) error {
	if _, err := db.Exec(schemaSQL); err != nil {
		return err
	}
	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('documents') WHERE name = 'archived'`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		if _, err := db.Exec(`ALTER TABLE documents ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`); err != nil {
			return err
		}
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('documents') WHERE name = 'folder_id'`).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		if _, err := db.Exec(`ALTER TABLE documents ADD COLUMN folder_id TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
	}
	_, err := db.Exec(`INSERT INTO meta(key, value) VALUES ('schema_version', '3')
		ON CONFLICT(key) DO UPDATE SET value = '3'`)
	return err
}

type DocInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Nodes     int    `json:"nodes"`
	Version   int64  `json:"version"`
	UpdatedAt int64  `json:"updatedAt"`
	CoverAt   int64  `json:"-"`
	Archived  bool   `json:"archived"`
	FolderID  string `json:"-"`
}

func ListDocuments(db *sql.DB) ([]DocInfo, error) {
	rows, err := db.Query(`SELECT d.id, d.name, d.version, d.updated_at, (SELECT COUNT(*) FROM nodes n WHERE n.doc_id = d.id),
		COALESCE((SELECT c.updated_at FROM covers c WHERE c.doc_id = d.id), 0), d.archived, d.folder_id
		FROM documents d ORDER BY d.updated_at DESC, d.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DocInfo
	for rows.Next() {
		var d DocInfo
		var archived int
		if err := rows.Scan(&d.ID, &d.Name, &d.Version, &d.UpdatedAt, &d.Nodes, &d.CoverAt, &archived, &d.FolderID); err != nil {
			return nil, err
		}
		d.Archived = archived != 0
		out = append(out, d)
	}
	return out, rows.Err()
}

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
	meta, err := loadTokenMeta(q, id)
	if err != nil {
		return nil, 0, err
	}
	assets, err := loadAssets(q, id)
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
	if meta != nil {
		raw.Set("tokenMeta", meta)
	}
	raw.Set("rootIds", rootIDs)
	raw.Set("nodes", nodes)
	if assets != nil {
		raw.Set("assets", assets)
	}
	doc, err := core.ParseDocument(raw)
	if err != nil {
		return nil, 0, &InvalidDocumentError{ID: id, Err: err}
	}
	return doc, version, nil
}

type InvalidDocumentError struct {
	ID  string
	Err error
}

func (e *InvalidDocumentError) Error() string {
	return fmt.Sprintf("workspace %q is invalid in the database and cannot be opened: %v", e.ID, e.Err)
}

func (e *InvalidDocumentError) Unwrap() error { return e.Err }

func (s *Store) loadDoc(id string) (*core.Document, int64, error) {
	doc, version, err := LoadDocument(s.db, id)
	s.invalidMu.Lock()
	defer s.invalidMu.Unlock()
	var inv *InvalidDocumentError
	switch {
	case err == nil:
		delete(s.invalid, id)
	case errors.As(err, &inv):
		if s.invalid == nil {
			s.invalid = map[string]string{}
		}
		s.invalid[id] = inv.Err.Error()
	}
	return doc, version, err
}

func (s *Store) invalidReason(id string) string {
	s.invalidMu.Lock()
	defer s.invalidMu.Unlock()
	return s.invalid[id]
}

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

func loadAssets(q querier, id string) (*jsonv.Object, error) {
	rows, err := q.Query(`SELECT name, src FROM assets WHERE doc_id = ? ORDER BY ord`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var assets *jsonv.Object
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		if assets == nil {
			assets = jsonv.NewObject()
		}
		assets.Set(k, v)
	}
	return assets, rows.Err()
}

func loadTokenMeta(q querier, id string) (*jsonv.Object, error) {
	rows, err := q.Query(`SELECT name, meta FROM token_meta WHERE doc_id = ? ORDER BY ord`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var meta *jsonv.Object
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		val, err := jsonv.Parse([]byte(v))
		if err != nil {
			return nil, err
		}
		if meta == nil {
			meta = jsonv.NewObject()
		}
		meta.Set(k, val)
	}
	return meta, rows.Err()
}

type querier interface {
	QueryRow(query string, args ...any) *sql.Row
	Query(query string, args ...any) (*sql.Rows, error)
	Exec(query string, args ...any) (sql.Result, error)
}

func writeDocument(tx querier, doc, prev *core.Document, version int64, now int64, dd *docDelta) error {
	id := doc.Str("id")
	if dd != nil {
		dd.begin(doc, prev)
	}
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
	}, `DELETE FROM tokens WHERE doc_id = ? AND name = ?`, dd.map_("tokens")); err != nil {
		return err
	}
	if err := syncRows(tx, `modes`, id, core.Modes(doc), prevObj(prev, core.Modes), func(k string, v any, ord int) error {
		_, err := tx.Exec(`INSERT INTO modes(doc_id, name, ord, tokens) VALUES (?, ?, ?, ?)
			ON CONFLICT(doc_id, name) DO UPDATE SET ord = excluded.ord, tokens = excluded.tokens`, id, k, ord, jsonv.Stringify(v, ""))
		return err
	}, `DELETE FROM modes WHERE doc_id = ? AND name = ?`, dd.map_("modes")); err != nil {
		return err
	}
	if err := syncRows(tx, `token_meta`, id, core.TokenMeta(doc), prevObj(prev, core.TokenMeta), func(k string, v any, ord int) error {
		_, err := tx.Exec(`INSERT INTO token_meta(doc_id, name, ord, meta) VALUES (?, ?, ?, ?)
			ON CONFLICT(doc_id, name) DO UPDATE SET ord = excluded.ord, meta = excluded.meta`, id, k, ord, jsonv.Stringify(v, ""))
		return err
	}, `DELETE FROM token_meta WHERE doc_id = ? AND name = ?`, dd.map_("tokenMeta")); err != nil {
		return err
	}
	if err := syncRows(tx, `assets`, id, core.Assets(doc), prevObj(prev, core.Assets), func(k string, v any, ord int) error {
		_, err := tx.Exec(`INSERT INTO assets(doc_id, name, ord, src) VALUES (?, ?, ?, ?)
			ON CONFLICT(doc_id, name) DO UPDATE SET ord = excluded.ord, src = excluded.src`, id, k, ord, v)
		return err
	}, `DELETE FROM assets WHERE doc_id = ? AND name = ?`, dd.map_("assets")); err != nil {
		return err
	}
	return syncRows(tx, `nodes`, id, core.Nodes(doc), prevObj(prev, core.Nodes), func(k string, v any, ord int) error {
		n := v.(*core.Node)
		pid, _ := n.Get("parentId")
		_, err := tx.Exec(`INSERT INTO nodes(doc_id, id, ord, parent_id, type, name, data) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(doc_id, id) DO UPDATE SET ord = excluded.ord, parent_id = excluded.parent_id, type = excluded.type,
			name = excluded.name, data = excluded.data`, id, k, ord, pid, n.Str("type"), n.Str("name"), jsonv.Stringify(n, ""))
		return err
	}, `DELETE FROM nodes WHERE doc_id = ? AND id = ?`, dd.map_("nodes"))
}

func writeTouched(tx querier, doc, prev *core.Document, version int64, now int64, dd *docDelta, touched []string) (bool, error) {
	nodes, prevNodes := core.Nodes(doc), core.Nodes(prev)
	if nodes == nil || prevNodes == nil || nodes.Len() != prevNodes.Len() {
		return false, nil
	}
	var changed []string
	for _, k := range touched {
		v, ok := nodes.Get(k)
		pv, pok := prevNodes.Get(k)
		if !ok || !pok {
			return false, nil
		}
		if pv != v && !jsonv.Equal(pv, v) {
			changed = append(changed, k)
		}
	}
	dd.begin(doc, prev)
	if !dd.valid || dd.rootIDs || dd.name {
		return false, nil
	}
	id := doc.Str("id")
	if _, err := tx.Exec(`UPDATE documents SET version = ?, updated_at = ? WHERE id = ?`, version, now, id); err != nil {
		return false, err
	}
	for _, k := range changed {
		v, _ := nodes.Get(k)
		n := v.(*core.Node)
		pid, _ := n.Get("parentId")
		res, err := tx.Exec(`UPDATE nodes SET parent_id = ?, type = ?, name = ?, data = ? WHERE doc_id = ? AND id = ?`,
			pid, n.Str("type"), n.Str("name"), jsonv.Stringify(n, ""), id, k)
		if err != nil {
			return false, err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return false, fmt.Errorf("node %q has no row in the database", k)
		}
	}
	dd.nodes.Set = changed
	return true, nil
}

func prevObj(prev *core.Document, f func(*core.Document) *jsonv.Object) *jsonv.Object {
	if prev == nil {
		return nil
	}
	return f(prev)
}

func syncRows(tx querier, _ string, docID string, cur, prev *jsonv.Object, upsert func(string, any, int) error, del string, md *mapDelta) error {
	prevKeys := prev.Keys()
	prevOrd := make(map[string]int, len(prevKeys))
	for i, k := range prevKeys {
		prevOrd[k] = i
	}
	j := 0
	seenNew := false
	for i, k := range cur.Keys() {
		v, _ := cur.Get(k)
		po, inPrev := prevOrd[k]
		same := false
		if inPrev {
			for j < len(prevKeys) && !cur.Has(prevKeys[j]) {
				j++
			}
			if seenNew || j >= len(prevKeys) || prevKeys[j] != k {
				if md != nil {
					md.Reordered = true
				}
			}
			j++
			pv, _ := prev.Get(k)
			same = pv == v || jsonv.Equal(pv, v)
		} else {
			seenNew = true
		}
		if inPrev && po == i && same {
			continue
		}
		if md != nil && !same {
			md.Set = append(md.Set, k)
		}
		if err := upsert(k, v, i); err != nil {
			return err
		}
	}
	if prev == nil {
		return nil
	}
	for _, k := range prevKeys {
		if !cur.Has(k) {
			if md != nil {
				md.Del = append(md.Del, k)
			}
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
			`DELETE FROM token_meta WHERE doc_id = ?`,
			`DELETE FROM assets WHERE doc_id = ?`,
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
	if err := writeDocument(tx, doc, nil, version, time.Now().UnixMilli(), nil); err != nil {
		return nil, err
	}
	return doc, tx.Commit()
}

func ExportDocument(db *sql.DB, id string) (string, error) {
	doc, _, err := LoadDocument(db, id)
	if err != nil {
		return "", err
	}
	return jsonv.Stringify(doc, "  ") + "\n", nil
}

var tokenRef = regexp.MustCompile(`\$[A-Za-z0-9_.-]{1,100}`)

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
			delete(keep, id)
			warnings = append(warnings, fmt.Sprintf(`conector "%s" descartado: a ponta aponta para "%s", que está fora de "%s"`, id, strings.Join(outside, `", "`), rootID))
		}
	}
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
	if srcMeta := core.TokenMeta(doc); srcMeta != nil {
		var metaOut *jsonv.Object
		for _, name := range tokens.Keys() {
			if m := srcMeta.Obj(name); m != nil {
				if metaOut == nil {
					metaOut = jsonv.NewObject()
				}
				metaOut.Set(name, jsonv.Clone(m))
			}
		}
		if metaOut != nil {
			out.Set("tokenMeta", metaOut)
		}
	}
	if _, err := core.ParseDocument(out); err != nil {
		return "", warnings, fmt.Errorf("documento exportado inválido (bug?): %w", err)
	}
	return jsonv.Stringify(out, "  ") + "\n", warnings, nil
}

type Store struct {
	mu           sync.Mutex
	db           *sql.DB
	path         string
	docID        string
	history      *core.History
	version      int64
	aside        map[string]*wsLive
	dataVersion  int64
	listeners    map[int]func(ChangeEvent)
	asideLis     map[int]func(AsideEvent)
	pinListeners map[int]func(string)
	nextID       int
	errHandler   func(error)
	stop         chan struct{}
	stopOnce     sync.Once
	Presence     *PresenceHub
	deleteGrants map[string]deleteGrant
	compare      compareMemory
	invalidMu    sync.Mutex
	invalid      map[string]string
}

type OpenOptions struct {
	DocID string
	Name  string
	Poll  time.Duration
	Log   func(string)
}

func OpenStore(path string, opts OpenOptions) (*Store, error) {
	db, err := OpenDB(path)
	if err != nil {
		return nil, err
	}
	s := &Store{db: db, path: path, listeners: map[int]func(ChangeEvent){}, pinListeners: map[int]func(string){}, stop: make(chan struct{}), Presence: NewPresenceHub(nil)}
	id := opts.DocID
	if id != "" {
		if err := s.load(id); err != nil {
			db.Close()
			return nil, err
		}
	} else {
		docs, err := ListDocuments(db)
		if err != nil {
			db.Close()
			return nil, err
		}
		for _, d := range docs {
			err := s.load(d.ID)
			if err == nil {
				id = d.ID
				break
			}
			var inv *InvalidDocumentError
			if !errors.As(err, &inv) {
				db.Close()
				return nil, err
			}
			if opts.Log != nil {
				opts.Log(fmt.Sprintf("workspace %q (%s) ignorado: documento inválido no banco: %v", d.Name, d.ID, inv.Err))
			}
		}
	}
	if id == "" {
		name := opts.Name
		if name == "" {
			name = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
			if name == "" {
				name = "Untitled"
			}
		}
		doc := core.CreateDocument(name, "")
		if err := writeDocument(db, doc, nil, 0, time.Now().UnixMilli(), nil); err != nil {
			db.Close()
			return nil, err
		}
		if err := s.load(doc.Str("id")); err != nil {
			db.Close()
			return nil, err
		}
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
	doc, version, err := s.loadDoc(id)
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

func (s *Store) Path() string { return s.path }

func (s *Store) DB() *sql.DB { return s.db }

func (s *Store) DocID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.docID
}

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

func (s *Store) OnPins(fn func(docID string)) func() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pinListeners == nil {
		s.pinListeners = map[int]func(string){}
	}
	id := s.nextID
	s.nextID++
	s.pinListeners[id] = fn
	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.pinListeners, id)
	}
}

func (s *Store) notifyPins(docID string) {
	s.mu.Lock()
	ls := make([]func(string), 0, len(s.pinListeners))
	for _, fn := range s.pinListeners {
		ls = append(ls, fn)
	}
	s.mu.Unlock()
	for _, fn := range ls {
		fn(docID)
	}
}

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

func (s *Store) OnAside(fn func(AsideEvent)) func() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.asideLis == nil {
		s.asideLis = map[int]func(AsideEvent){}
	}
	id := s.nextID
	s.nextID++
	s.asideLis[id] = fn
	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.asideLis, id)
	}
}

func (s *Store) asideListenersLocked() []func(AsideEvent) {
	ls := make([]func(AsideEvent), 0, len(s.asideLis))
	for _, fn := range s.asideLis {
		ls = append(ls, fn)
	}
	return ls
}

func (s *Store) OnError(fn func(error)) { s.errHandler = fn }

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

type wsLive struct {
	history *core.History
	version int64
}

type WorkspaceHead struct {
	ID      string
	Name    string
	Version int64
	Doc     *core.Document
	CanUndo bool
	CanRedo bool
}

func (s *Store) persistLocked(docID string, doc, prev *core.Document, version int64, undo, redo []core.HistoryEntry, step *HistoryStep, touched []string, scoped bool) (*docDelta, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	dd := &docDelta{}
	done := false
	if scoped {
		done, err = writeTouched(tx, doc, prev, version, time.Now().UnixMilli(), dd, touched)
		if err != nil {
			return nil, err
		}
	}
	if !done {
		*dd = docDelta{}
		if err := writeDocument(tx, doc, prev, version, time.Now().UnixMilli(), dd); err != nil {
			return nil, err
		}
	}
	if err := writeHistory(tx, docID, undo, redo); err != nil {
		return nil, err
	}
	if step != nil {
		if err := writeHistoryStep(tx, docID, *step); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	s.dataVersion = s.readDataVersion()
	if !dd.usable() {
		return nil, nil
	}
	return dd, nil
}

func writeHistoryStep(tx *sql.Tx, docID string, st HistoryStep) error {
	_, err := tx.Exec(`INSERT INTO history_steps(doc_id, kind, actor, label, at) VALUES (?, ?, ?, ?, ?)`, docID, st.Kind, st.Actor, st.Label, st.At)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`DELETE FROM history_steps WHERE doc_id = ? AND seq NOT IN (SELECT seq FROM history_steps WHERE doc_id = ? ORDER BY seq DESC LIMIT ?)`, docID, docID, maxHistorySteps)
	return err
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

func (s *Store) commitLocked(prev *core.Document, actor, label, kind string, step *HistoryStep) ([]func(ChangeEvent), ChangeEvent, error) {
	version := s.version + 1
	doc := s.history.Doc()
	touched, scoped := s.history.LastTouched()
	dd, err := s.persistLocked(s.docID, doc, prev, version, s.history.Entries(), s.history.RedoEntries(), step, touched, scoped)
	if err != nil {
		return nil, ChangeEvent{}, err
	}
	s.version = version
	return s.listenersLocked(), ChangeEvent{doc, version, actor, label, kind, s.docID, version - 1, dd}, nil
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
	doc, version, err := s.loadDoc(id)
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
	touched, scoped := live.history.LastTouched()
	dd, err := s.persistLocked(target, live.history.Doc(), prevDoc, version, live.history.Entries(), live.history.RedoEntries(), nil, touched, scoped)
	if err != nil {
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
	if !r.Scoped() {
		removedIDs(prevDoc, r)
	}
	head := headOf(target, live)
	var ls []func(ChangeEvent)
	var als []func(AsideEvent)
	var ev ChangeEvent
	if !aside {
		ls = s.listenersLocked()
		ev = ChangeEvent{head.Doc, version, actor, label, "apply", target, version - 1, dd}
	} else {
		als = s.asideListenersLocked()
		ev = ChangeEvent{head.Doc, version, actor, label, "apply", target, version - 1, dd}
	}
	s.mu.Unlock()
	if !aside {
		emit(ls, ev)
	} else {
		emitAside(als, AsideEvent{ev, head.CanUndo, head.CanRedo})
	}
	return r, head, nil
}

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
	touched, scoped := live.history.LastTouched()
	dd, err := s.persistLocked(target, live.history.Doc(), prevDoc, version, live.history.Entries(), live.history.RedoEntries(), &HistoryStep{kind, actor, time.Now().UnixMilli(), e.Label}, touched, scoped)
	if err != nil {
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
	var als []func(AsideEvent)
	ev := ChangeEvent{head.Doc, version, actor, prefix + ": " + what, kind, target, version - 1, dd}
	if !aside {
		ls = s.listenersLocked()
	} else {
		als = s.asideListenersLocked()
	}
	s.mu.Unlock()
	if !aside {
		emit(ls, ev)
	} else {
		emitAside(als, AsideEvent{ev, head.CanUndo, head.CanRedo})
	}
	return true, head, nil
}

func summaries(entries []core.HistoryEntry, limit int) []HistorySummary {
	if limit < len(entries) {
		entries = entries[len(entries)-limit:]
	}
	out := make([]HistorySummary, len(entries))
	for i, e := range entries {
		out[i] = HistorySummary{e.Actor, e.Label, e.At, len(e.Ops)}
	}
	return out
}

func (s *Store) HistoryViewIn(id string, limit int) (HistoryView, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	live, aside, err := s.liveLocked(id)
	if err != nil {
		return HistoryView{}, err
	}
	target := s.docID
	if aside {
		target = id
	}
	rows, err := s.db.Query(`SELECT kind, actor, at, label FROM history_steps WHERE doc_id = ? ORDER BY seq DESC LIMIT ?`, target, limit)
	if err != nil {
		return HistoryView{}, err
	}
	defer rows.Close()
	steps := []HistoryStep{}
	for rows.Next() {
		var st HistoryStep
		if err := rows.Scan(&st.Kind, &st.Actor, &st.At, &st.Label); err != nil {
			return HistoryView{}, err
		}
		steps = append(steps, st)
	}
	if err := rows.Err(); err != nil {
		return HistoryView{}, err
	}
	for i, j := 0, len(steps)-1; i < j; i, j = i+1, j-1 {
		steps[i], steps[j] = steps[j], steps[i]
	}
	return HistoryView{
		Entries: summaries(live.history.Entries(), limit),
		Redo:    summaries(live.history.RedoEntries(), limit),
		Steps:   steps,
		CanUndo: live.history.CanUndo(),
		CanRedo: live.history.CanRedo(),
	}, nil
}

func emitAside(ls []func(AsideEvent), e AsideEvent) {
	for _, fn := range ls {
		fn(e)
	}
}

func emit(ls []func(ChangeEvent), e ChangeEvent) {
	for _, fn := range ls {
		fn(e)
	}
}

func (s *Store) Apply(ops []any, actor, label string) (*core.ApplyResult, error) {
	return s.ApplyBatch(ops, actor, label, "")
}

func (s *Store) ApplyBatch(ops []any, actor, label, batch string) (*core.ApplyResult, error) {
	s.mu.Lock()
	prevDoc := s.history.Doc()
	prevUndo, prevRedo := s.history.Entries(), s.history.RedoEntries()
	r, err := s.history.ApplyBatch(ops, actor, label, batch)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	ls, ev, err := s.commitLocked(prevDoc, actor, label, "apply", nil)
	if err != nil {
		s.history = core.Restore(prevDoc, prevUndo, prevRedo)
		s.mu.Unlock()
		return nil, fmt.Errorf("falha ao gravar no banco: %w", err)
	}
	if !r.Scoped() {
		removedIDs(prevDoc, r)
	}
	s.mu.Unlock()
	emit(ls, ev)
	return r, nil
}

type RemoteResult struct {
	Ops     int
	Failed  []string
	Created bool
}

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
		ls, ev, err := s.commitLocked(prev, actor, label, "remote", nil)
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
	doc, version, err := s.loadDoc(docID)
	var prev *core.Document
	if err != nil {
		var exists int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM documents WHERE id = ?`, docID).Scan(&exists)
		if exists > 0 {
			return res, err
		}
		if name == "" {
			name = "Untitled"
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
	if err := writeDocument(tx, next, prev, version+1, time.Now().UnixMilli(), nil); err != nil {
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
	ls, ev, err := s.commitLocked(prevDoc, actor, prefix+": "+what, kind, &HistoryStep{kind, actor, time.Now().UnixMilli(), e.Label})
	if err != nil {
		s.history = core.Restore(prevDoc, prevUndo, prevRedo)
		s.mu.Unlock()
		return false, fmt.Errorf("falha ao gravar no banco: %w", err)
	}
	s.mu.Unlock()
	emit(ls, ev)
	return true, nil
}

func (s *Store) Undo(actor string) (bool, error) { return s.step(actor, false) }

func (s *Store) Redo(actor string) (bool, error) { return s.step(actor, true) }

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
	ev := ChangeEvent{s.history.Doc(), s.version, "db", "banco alterado por outro processo", "reload", s.docID, 0, nil}
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

func (s *Store) Close() error {
	s.stopOnce.Do(func() { close(s.stop) })
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.Close()
}

type WorkspaceInfo struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Nodes     int            `json:"nodes"`
	UpdatedAt int64          `json:"updatedAt"`
	Active    bool           `json:"active"`
	Cover     any            `json:"cover"`
	Archived  bool           `json:"archived"`
	FolderID  string         `json:"folderId"`
	Preview   []PreviewShape `json:"preview"`
	Error     string         `json:"error,omitempty"`
}

func coverURL(id string, at int64) any {
	if at == 0 {
		return nil
	}
	return fmt.Sprintf("/api/workspaces/%s/cover?v=%d", url.PathEscape(id), at)
}

var ErrNoWorkspace = errors.New("workspace not found")

func (s *Store) ListWorkspaces() ([]WorkspaceInfo, error) {
	return s.listWorkspaces(false, false)
}

func (s *Store) ListWorkspacesFiltered(includeArchived, archivedOnly bool) ([]WorkspaceInfo, error) {
	return s.listWorkspaces(includeArchived, archivedOnly)
}

func (s *Store) listWorkspaces(includeArchived, archivedOnly bool) ([]WorkspaceInfo, error) {
	docs, err := ListDocuments(s.db)
	if err != nil {
		return nil, err
	}
	active := s.DocID()
	out := make([]WorkspaceInfo, 0, len(docs))
	for _, d := range docs {
		if archivedOnly && !d.Archived {
			continue
		}
		if !includeArchived && !archivedOnly && d.Archived {
			continue
		}
		preview, err := previewShapes(s.db, d.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, WorkspaceInfo{
			ID: d.ID, Name: d.Name, Nodes: d.Nodes, UpdatedAt: d.UpdatedAt,
			Active: d.ID == active, Cover: coverURL(d.ID, d.CoverAt), Archived: d.Archived,
			FolderID: d.FolderID, Preview: preview, Error: s.invalidReason(d.ID),
		})
	}
	return out, nil
}

func (s *Store) workspaceInfo(id string) (WorkspaceInfo, error) {
	ws, err := s.listWorkspaces(true, false)
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

type WorkspaceOp struct {
	At      int64  `json:"at"`
	Actor   string `json:"actor"`
	Op      string `json:"op"`
	DocID   string `json:"workspaceId"`
	DocName string `json:"workspaceName"`
	Detail  any    `json:"detail"`
}

const MaxWorkspaceOps = 200

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

func (s *Store) OpenWorkspace(id, actor string) (WorkspaceInfo, error) {
	info, err := s.workspaceInfo(id)
	if err != nil {
		return info, err
	}
	if info.Archived {
		if err := s.writeArchived(id, false); err != nil {
			return WorkspaceInfo{}, err
		}
		s.logWorkspaceOp(actor, "unarchive", id, info.Name, map[string]any{"via": "open"})
		info.Archived = false
	}
	if info.Active {
		return info, nil
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
	ev := ChangeEvent{doc, s.version, actor, "abrir workspace: " + doc.Str("name"), "open", s.docID, 0, nil}
	s.mu.Unlock()
	emit(ls, ev)
	s.logWorkspaceOp(actor, "open", id, info.Name, nil)
	info.Active = true
	return info, nil
}

func (s *Store) CreateWorkspace(name, actor string) (WorkspaceInfo, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Untitled"
	}
	doc := core.CreateDocument(name, "")
	now := time.Now().UnixMilli()
	if err := writeDocument(s.db, doc, nil, 0, now, nil); err != nil {
		return WorkspaceInfo{}, err
	}
	s.logWorkspaceOp(actor, "create", doc.Str("id"), name, nil)
	return s.workspaceInfo(doc.Str("id"))
}

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
	if err := writeDocument(s.db, doc, nil, 0, now, nil); err != nil {
		return WorkspaceInfo{}, err
	}
	info, err := s.workspaceInfo(id)
	if err == nil {
		s.logWorkspaceOp(actor, "create", id, info.Name, map[string]any{"source": "import"})
	}
	return info, err
}

var ErrLastWorkspace = errors.New("cannot delete the only workspace")

var ErrArchiveOnly = errors.New("cannot archive the only workspace")

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
	if err := writeDocument(tx, r.Doc, doc, version+1, now, nil); err != nil {
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
	Undoable       bool   `json:"undoable"`
}

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

func mustList(s *Store) []WorkspaceInfo {
	ws, err := s.ListWorkspaces()
	if err != nil {
		return nil
	}
	return ws
}

const DeleteConfirmTTL = 2 * time.Minute

var (
	ErrBadConfirmToken     = errors.New("confirmToken is not valid")
	ErrExpiredConfirmToken = errors.New("confirmToken has expired")
)

type deleteGrant struct {
	docID     string
	expiresAt int64
}

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

func (s *Store) DeleteWorkspace(id, actor string) (string, error) {
	ws, err := s.listWorkspaces(true, false)
	if err != nil {
		return "", err
	}
	var target *WorkspaceInfo
	next := ""
	for i := range ws {
		if ws[i].ID == id {
			target = &ws[i]
		} else if next == "" && !ws[i].Archived {
			next = ws[i].ID
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
	if _, err := s.db.Exec(`DELETE FROM documents WHERE id = ?`, id); err != nil {
		return "", err
	}
	s.mu.Lock()
	delete(s.aside, id)
	s.mu.Unlock()
	s.logWorkspaceOp(actor, "delete", id, target.Name, summary)
	return s.DocID(), nil
}

func (s *Store) writeArchived(id string, archived bool) error {
	flag := 0
	if archived {
		flag = 1
	}
	res, err := s.db.Exec(`UPDATE documents SET archived = ?, updated_at = ? WHERE id = ?`, flag, time.Now().UnixMilli(), id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNoWorkspace
	}
	return nil
}

func (s *Store) ArchiveWorkspace(id, actor string) (WorkspaceInfo, error) {
	info, err := s.workspaceInfo(id)
	if err != nil {
		return info, err
	}
	if info.Archived {
		return info, nil
	}
	ws, err := s.listWorkspaces(true, false)
	if err != nil {
		return WorkspaceInfo{}, err
	}
	next := ""
	for _, w := range ws {
		if w.ID != id && !w.Archived {
			next = w.ID
			break
		}
	}
	if next == "" {
		return WorkspaceInfo{}, ErrArchiveOnly
	}
	if info.Active {
		if _, err := s.OpenWorkspace(next, actor); err != nil {
			return WorkspaceInfo{}, err
		}
	}
	if err := s.writeArchived(id, true); err != nil {
		return WorkspaceInfo{}, err
	}
	s.logWorkspaceOp(actor, "archive", id, info.Name, nil)
	return s.workspaceInfo(id)
}

func (s *Store) UnarchiveWorkspace(id, actor string) (WorkspaceInfo, error) {
	info, err := s.workspaceInfo(id)
	if err != nil {
		return info, err
	}
	if !info.Archived {
		return info, nil
	}
	if err := s.writeArchived(id, false); err != nil {
		return WorkspaceInfo{}, err
	}
	s.logWorkspaceOp(actor, "unarchive", id, info.Name, nil)
	return s.workspaceInfo(id)
}

const MaxCoverBytes = 2 * 1024 * 1024

var ErrBadCover = errors.New("cover must be a PNG, JPEG, WebP or GIF image of at most 2 MiB")

var coverTypes = map[string]bool{"image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true}

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

func (s *Store) ClearCover(id string) (WorkspaceInfo, error) {
	if _, err := s.workspaceInfo(id); err != nil {
		return WorkspaceInfo{}, err
	}
	if _, err := s.db.Exec(`DELETE FROM covers WHERE doc_id = ?`, id); err != nil {
		return WorkspaceInfo{}, err
	}
	return s.workspaceInfo(id)
}

func (s *Store) Cover(id string) ([]byte, string, error) {
	var data []byte
	var mime string
	err := s.db.QueryRow(`SELECT data, mime FROM covers WHERE doc_id = ?`, id).Scan(&data, &mime)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrNoWorkspace
	}
	return data, mime, err
}

func (s *Store) WorkspaceDocument(id string) (*core.Document, error) {
	if id == s.DocID() {
		return s.Doc(), nil
	}
	if _, err := s.workspaceInfo(id); err != nil {
		return nil, err
	}
	doc, _, err := s.loadDoc(id)
	return doc, err
}
