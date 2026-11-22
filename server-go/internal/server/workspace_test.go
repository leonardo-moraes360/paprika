package server

import (
	"errors"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func TestWorkspacesListOpenCreate(t *testing.T) {
	s, _ := openTemp(t)
	first := s.DocID()
	createRect(t, s, "a")

	created, err := s.CreateWorkspace("  Landing  ", "user")
	if err != nil {
		t.Fatal(err)
	}
	if created.Name != "Landing" || created.Active || created.Nodes != 0 {
		t.Fatalf("created = %+v", created)
	}
	if blank, _ := s.CreateWorkspace(" ", "user"); blank.Name != "Sem título" {
		t.Fatalf("blank name = %q", blank.Name)
	}
	ws, err := s.ListWorkspaces()
	if err != nil || len(ws) != 3 {
		t.Fatalf("list = %+v, %v", ws, err)
	}
	active := 0
	for _, w := range ws {
		if w.Active {
			active++
			if w.ID != first || w.Nodes != 1 {
				t.Fatalf("active = %+v", w)
			}
		}
	}
	if active != 1 {
		t.Fatalf("%d active workspaces", active)
	}

	var events []ChangeEvent
	s.OnChange(func(e ChangeEvent) { events = append(events, e) })
	opened, err := s.OpenWorkspace(created.ID, "user")
	if err != nil || !opened.Active || s.DocID() != created.ID || s.Doc().Str("name") != "Landing" {
		t.Fatalf("open = %+v, %v (active %s)", opened, err, s.DocID())
	}
	if len(events) != 1 || events[0].Kind != "open" || events[0].Doc.Str("id") != created.ID {
		t.Fatalf("events = %+v", events)
	}
	if s.CanUndo() {
		t.Fatal("the new workspace must not inherit the undo history")
	}
	// Writes go to the active workspace; the previous one keeps its own history.
	createRect(t, s, "b")
	if _, err := s.OpenWorkspace(first, "user"); err != nil {
		t.Fatal(err)
	}
	if !s.CanUndo() || s.Doc().Obj("nodes").Has("b") || !s.Doc().Obj("nodes").Has("a") {
		t.Fatal("switching back must restore that workspace's document and history")
	}
	// Opening the active one again is a no-op.
	if _, err := s.OpenWorkspace(first, "user"); err != nil || len(events) != 3 { // open, apply b, open first
		t.Fatalf("reopen: %v, %d events", err, len(events))
	}
	if _, err := s.OpenWorkspace("nope", "user"); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("unknown id: %v", err)
	}
}

func TestWorkspacesRenameDelete(t *testing.T) {
	s, _ := openTemp(t)
	first := s.DocID()
	if _, err := s.DeleteWorkspace(first, "user"); !errors.Is(err, ErrLastWorkspace) {
		t.Fatalf("delete only workspace: %v", err)
	}
	other, err := s.CreateWorkspace("Outro", "user")
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.RenameWorkspace(other.ID, "  Marca  ", "user")
	if err != nil || got.Name != "Marca" || got.Active {
		t.Fatalf("rename other = %+v, %v", got, err)
	}
	if doc, _, err := LoadDocument(s.DB(), other.ID); err != nil || doc.Str("name") != "Marca" {
		t.Fatalf("stored name: %v", err)
	}
	if _, err := s.RenameWorkspace(other.ID, " ", "user"); err == nil {
		t.Fatal("blank name must fail")
	}
	if _, err := s.RenameWorkspace("nope", "x", "user"); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("rename unknown: %v", err)
	}

	before := s.Doc().Str("name")
	if _, err := s.RenameWorkspace(first, "Ativo", "user"); err != nil || s.Doc().Str("name") != "Ativo" || !s.CanUndo() {
		t.Fatalf("rename active: %v (%q)", err, s.Doc().Str("name"))
	}
	if ok, _ := s.Undo("user"); !ok || s.Doc().Str("name") != before {
		t.Fatalf("undo rename: %q", s.Doc().Str("name"))
	}

	createRect(t, s, "a")
	var events []ChangeEvent
	s.OnChange(func(e ChangeEvent) { events = append(events, e) })
	active, err := s.DeleteWorkspace(first, "user")
	if err != nil || active != other.ID || s.DocID() != other.ID {
		t.Fatalf("delete active = %q, %v (active %s)", active, err, s.DocID())
	}
	if len(events) != 1 || events[0].Kind != "open" {
		t.Fatalf("events = %+v", events)
	}
	var n int
	for _, table := range []string{"documents", "nodes", "history"} {
		if err := s.DB().QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE `+map[bool]string{true: "id", false: "doc_id"}[table == "documents"]+` = ?`, first).Scan(&n); err != nil || n != 0 {
			t.Fatalf("%s rows left for deleted doc: %d, %v", table, n, err)
		}
	}
	if _, err := s.DeleteWorkspace(first, "user"); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("delete twice: %v", err)
	}
}

func TestWorkspaceCover(t *testing.T) {
	s, _ := openTemp(t)
	id := s.DocID()
	png := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89")
	if ws, _ := s.ListWorkspaces(); ws[0].Cover != nil {
		t.Fatalf("new workspace has a cover: %v", ws[0].Cover)
	}
	if _, err := s.SetCover(id, []byte("<svg xmlns='http://www.w3.org/2000/svg'/>")); !errors.Is(err, ErrBadCover) {
		t.Fatalf("svg cover: %v", err)
	}
	if _, err := s.SetCover(id, make([]byte, MaxCoverBytes+1)); !errors.Is(err, ErrBadCover) {
		t.Fatalf("big cover: %v", err)
	}
	if _, err := s.SetCover("nope", png); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("unknown id: %v", err)
	}
	info, err := s.SetCover(id, png)
	if err != nil || info.Cover == nil {
		t.Fatalf("set cover = %+v, %v", info, err)
	}
	data, mime, err := s.Cover(id)
	if err != nil || mime != "image/png" || string(data) != string(png) {
		t.Fatalf("cover = %q %v", mime, err)
	}
	if info, err = s.ClearCover(id); err != nil || info.Cover != nil {
		t.Fatalf("clear = %+v, %v", info, err)
	}
	if _, _, err := s.Cover(id); !errors.Is(err, ErrNoWorkspace) {
		t.Fatalf("cover after clear: %v", err)
	}
	// Deleting the workspace drops its cover (cascade).
	other, _ := s.CreateWorkspace("Outro", "user")
	if _, err := s.SetCover(other.ID, png); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteWorkspace(other.ID, "user"); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := s.DB().QueryRow(`SELECT COUNT(*) FROM covers`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("covers left: %d, %v", n, err)
	}
}

func TestImportWorkspaceKeepsActive(t *testing.T) {
	s, _ := openTemp(t)
	active := s.DocID()
	createRect(t, s, "a")
	doc := func() *jsonv.Object {
		return jsonv.NewObject(
			"format", "paprika/1", "id", "board-doc", "name", "Board EN",
			"rootIds", []any{"a"},
			"nodes", jsonv.NewObject("a", jsonv.NewObject("type", "rect", "id", "a", "parentId", nil, "x", 0.0, "y", 0.0, "width", 10.0, "height", 10.0)),
			"tokens", jsonv.NewObject(),
		)
	}
	info, err := s.ImportWorkspace(doc(), "  Copiado  ", "user")
	if err != nil {
		t.Fatal(err)
	}
	if info.ID != "board-doc" || info.Name != "Copiado" || info.Active || info.Nodes != 1 {
		t.Fatalf("info = %+v", info)
	}
	if s.DocID() != active {
		t.Fatalf("active switched to %s", s.DocID())
	}
	// Same id again: a copy with a new document id, node ids kept.
	info2, err := s.ImportWorkspace(doc(), "", "user")
	if err != nil {
		t.Fatal(err)
	}
	if info2.ID == "board-doc" || info2.Name != "Board EN" {
		t.Fatalf("copy = %+v", info2)
	}
	loaded, err := s.WorkspaceDocument(info2.ID)
	if err != nil || !loaded.Obj("nodes").Has("a") || loaded.Str("name") != "Board EN" {
		t.Fatalf("copy doc: %v, %+v", err, loaded)
	}
	// Invalid input: an actionable error, no workspace written.
	if _, err := s.ImportWorkspace(jsonv.NewObject("format", "paprika/1"), "", "user"); err == nil || !strings.HasPrefix(err.Error(), "document:") {
		t.Fatalf("invalid doc error: %v", err)
	}
	if ws, _ := s.ListWorkspaces(); len(ws) != 3 {
		t.Fatalf("workspaces = %+v", ws)
	}
}

func TestExportFrameStandalone(t *testing.T) {
	s, _ := openTemp(t)
	apply := func(ops ...any) *core.ApplyResult {
		t.Helper()
		r, err := s.Apply(ops, "test", "setup")
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	apply(jsonv.NewObject("op", "set_tokens", "tokens", jsonv.NewObject(
		"ink", "#111111", "paper", "#fbf8f4", "accent", "$ink", "unused", "#123456",
	)))
	apply(jsonv.NewObject("op", "create", "node", jsonv.NewObject(
		"type", "frame", "id", "comp", "name", "Chip", "component", true, "x", 500.0, "y", 0.0, "width", 60.0, "height", 60.0, "fill", "$ink",
		"children", []any{jsonv.NewObject("type", "rect", "id", "ck", "x", 5.0, "y", 5.0, "width", 20.0, "height", 20.0)},
	)))
	apply(jsonv.NewObject("op", "create", "node", jsonv.NewObject("type", "rect", "id", "fora", "x", 900.0, "y", 0.0, "width", 30.0, "height", 30.0)))
	apply(jsonv.NewObject("op", "create", "node", jsonv.NewObject(
		"type", "frame", "id", "board", "name", "Board", "x", 0.0, "y", 0.0, "width", 300.0, "height", 200.0, "fill", "$paper",
		"children", []any{
			jsonv.NewObject("type", "shape", "id", "a", "shape", "rect", "x", 10.0, "y", 10.0, "width", 80.0, "height", 40.0, "fill", "$accent"),
			jsonv.NewObject("type", "shape", "id", "b", "shape", "rect", "x", 150.0, "y", 60.0, "width", 80.0, "height", 40.0, "color", "$ink"),
			jsonv.NewObject("type", "connector", "id", "k-in", "from", jsonv.NewObject("nodeId", "a"), "to", jsonv.NewObject("nodeId", "b")),
			jsonv.NewObject("type", "connector", "id", "k-out", "from", jsonv.NewObject("nodeId", "a"), "to", jsonv.NewObject("nodeId", "fora")),
		},
	)))
	apply(jsonv.NewObject("op", "create", "parentId", "board", "node", jsonv.NewObject("type", "frame", "id", "inst", "instanceOf", "comp", "x", 20.0, "y", 120.0)))

	text, warnings, err := ExportFrame(s.DB(), s.DocID(), "board")
	if err != nil {
		t.Fatal(err)
	}
	if len(warnings) != 1 || !strings.Contains(warnings[0], `"k-out"`) || !strings.Contains(warnings[0], `"fora"`) {
		t.Fatalf("warnings = %v", warnings)
	}
	v, err := jsonv.Parse([]byte(text))
	if err != nil {
		t.Fatal(err)
	}
	exported := v.(*jsonv.Object)
	if _, err := core.ParseDocument(exported); err != nil {
		t.Fatalf("exported document invalid: %v", err)
	}
	nodes := exported.Obj("nodes")
	for _, id := range []string{"board", "a", "b", "k-in", "comp", "ck", "inst"} {
		if !nodes.Has(id) {
			t.Fatalf("node %q missing from the export (%v)", id, nodes.Keys())
		}
	}
	for _, id := range []string{"fora", "k-out"} {
		if nodes.Has(id) {
			t.Fatalf("node %q must not be in the export", id)
		}
	}
	copies := 0
	for _, id := range nodes.Keys() {
		if nodes.Obj(id).Has("sourceId") {
			copies++
		}
	}
	if copies < 1 {
		t.Fatal("instance copies must come along with the instance")
	}
	if nodes.Obj("board").Has("parentId") && nodes.Obj("board").Str("parentId") != "" {
		if p, _ := nodes.Obj("board").Get("parentId"); p != nil {
			t.Fatalf("the root must be re-parented to null, got %v", p)
		}
	}
	if roots := exported.Strings("rootIds"); len(roots) != 2 || roots[0] != "comp" || roots[1] != "board" {
		t.Fatalf("rootIds = %v (the top level keeps the document's order)", roots)
	}
	if exported.Str("name") != "Board" {
		t.Fatalf("name = %q", exported.Str("name"))
	}
	tk := exported.Obj("tokens")
	for _, name := range []string{"ink", "paper", "accent"} {
		if !tk.Has(name) {
			t.Fatalf("token %q missing", name)
		}
	}
	if tk.Has("unused") {
		t.Fatal("an unreferenced token must not be exported")
	}
	// Round trip: importing the standalone file creates a workspace without switching.
	active := s.DocID()
	info, err := s.ImportWorkspace(mustParse(t, text), "", "user")
	if err != nil {
		t.Fatal(err)
	}
	if info.ID == s.DocID() || info.Nodes != nodes.Len() || info.Active {
		t.Fatalf("import = %+v", info)
	}
	if s.DocID() != active {
		t.Fatalf("active switched to %s", s.DocID())
	}
	docB, err := s.WorkspaceDocument(info.ID)
	if err != nil || !docB.Obj("nodes").Has("board") || docB.Obj("nodes").Len() != nodes.Len() {
		t.Fatalf("imported doc: %v, %+v", err, docB)
	}
}

func mustParse(t *testing.T, text string) *jsonv.Object {
	t.Helper()
	v, err := jsonv.Parse([]byte(text))
	if err != nil {
		t.Fatal(err)
	}
	return v.(*jsonv.Object)
}

func TestCreateNodesIgnoresDerivedConnectorFields(t *testing.T) {
	s, _ := openTemp(t)
	createRect(t, s, "a")
	createRect(t, s, "b")
	m := NewMCP(s, "agent:test", nil)
	text, isErr := callText(t, m, "create_nodes", jsonv.NewObject("nodes", []any{
		jsonv.NewObject("type", "connector", "id", "c1",
			"from", jsonv.NewObject("nodeId", "a"), "to", jsonv.NewObject("nodeId", "b"),
			"x", 0.0, "y", 0.0, "width", 77.0, "height", 9.0, "d", "M0 0 L1 1"),
	}))
	if isErr {
		t.Fatalf("create_nodes refused derived fields: %s", text)
	}
	if !strings.Contains(text, `connector "c1"`) || !strings.Contains(text, "were ignored") {
		t.Fatalf("no warning in result: %s", text)
	}
	c1 := s.Doc().Obj("nodes").Obj("c1")
	if c1.Str("d") == "M0 0 L1 1" {
		t.Fatal("the copied d must not be stored (geometry comes from the ends)")
	}
	if c1.Num("width") == 77.0 && c1.Num("height") == 9.0 {
		t.Fatal("the geometry must come from the endpoints, not from the payload")
	}
	// apply_ops (the raw op) still refuses derived fields.
	_, isErr = callText(t, m, "apply_ops", jsonv.NewObject("ops", []any{
		jsonv.NewObject("op", "create", "node", jsonv.NewObject("type", "connector", "id", "c2", "d", "M0 0 L1 1")),
	}))
	if !isErr {
		t.Fatal("apply_ops must keep refusing derived connector fields")
	}
}

// quotedAfter returns the string value written after "key": in a JSON text.
func quotedAfter(text, key string) string {
	i := strings.Index(text, `"`+key+`"`)
	if i < 0 {
		return ""
	}
	colon := strings.Index(text[i:], ":")
	if colon < 0 {
		return ""
	}
	rest := text[i+colon+1:]
	open := strings.Index(rest, `"`)
	if open < 0 {
		return ""
	}
	rest = rest[open+1:]
	end := strings.Index(rest, `"`)
	if end < 0 {
		return ""
	}
	return rest[:end]
}

// PAP-B-015: an agent's delete_workspace is two calls — the first only says what would be lost — and every
// workspace operation leaves a readable entry that outlives the workspace it names.
func TestWorkspaceDeleteNeedsTokenAndLogsOps(t *testing.T) {
	s, _ := openTemp(t)
	first := s.DocID()
	createRect(t, s, "a")
	other, err := s.CreateWorkspace("Outro", "user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.RenameWorkspace(other.ID, "Outro 2", "agent:claude"); err != nil {
		t.Fatal(err)
	}
	m := NewMCP(s, "agent:claude", nil)

	text, isErr := callText(t, m, "delete_workspace", jsonv.NewObject("id", first))
	if isErr {
		t.Fatalf("first call refused: %s", text)
	}
	flat := strings.Join(strings.Fields(text), "")
	for _, want := range []string{`"needsConfirmation":true`, `"confirmToken":`, `"nodes":1`, `"active":true`, `"undoable":false`} {
		if !strings.Contains(flat, want) {
			t.Fatalf("summary missing %s in %s", want, text)
		}
	}
	if ws, err := s.ListWorkspaces(); err != nil || len(ws) != 2 {
		t.Fatalf("the first call deleted something: %+v %v", ws, err)
	}
	// The text result is pretty-printed, so read the value between its quotes rather than assume a shape.
	token := quotedAfter(text, "confirmToken")
	if token == "" {
		t.Fatalf("no token in %s", text)
	}
	// A token belongs to one workspace: pointing it at another is refused with an actionable message.
	if text, isErr = callText(t, m, "delete_workspace", jsonv.NewObject("id", other.ID, "confirmToken", token)); !isErr || !strings.Contains(text, "not valid") {
		t.Fatalf("token reused on another workspace: %s %v", text, isErr)
	}
	// An expired token says so, and points at the first call again.
	s.mu.Lock()
	grant := s.deleteGrants[token]
	grant.expiresAt = 1
	s.deleteGrants[token] = grant
	s.mu.Unlock()
	if text, isErr = callText(t, m, "delete_workspace", jsonv.NewObject("id", first, "confirmToken", token)); !isErr || !strings.Contains(text, "expired") {
		t.Fatalf("expired token: %s %v", text, isErr)
	}
	// Fresh token, same workspace: the delete goes through and moves the canvas to the successor.
	issued, ttl, err := s.IssueDeleteConfirm(first)
	if err != nil || ttl <= 0 {
		t.Fatalf("issue: %v %d", err, ttl)
	}
	if text, isErr = callText(t, m, "delete_workspace", jsonv.NewObject("id", first, "confirmToken", issued)); isErr {
		t.Fatalf("second call: %s", text)
	}
	flat = strings.Join(strings.Fields(text), "")
	if !strings.Contains(flat, `"deleted":"`+first+`"`) || !strings.Contains(flat, `"active":"`+other.ID+`"`) {
		t.Fatalf("delete result: %s", text)
	}
	if err := s.ConsumeDeleteConfirm(first, issued); !errors.Is(err, ErrBadConfirmToken) {
		t.Fatalf("the token was not single-use: %v", err)
	}

	// The log: who created, renamed, opened and deleted, newest first, with the delete summary kept.
	text, isErr = callText(t, m, "list_workspace_ops", jsonv.NewObject("limit", 20.0))
	if isErr {
		t.Fatalf("list_workspace_ops: %s", text)
	}
	flat = strings.Join(strings.Fields(text), "")
	for _, want := range []string{`"op":"delete"`, `"actor":"agent:claude"`, `"op":"rename"`, `"op":"create"`, `"op":"open"`, "Outro2"} {
		if !strings.Contains(flat, want) {
			t.Fatalf("log missing %s in %s", want, text)
		}
	}
	entries, err := s.ListWorkspaceOps(50, first)
	if err != nil || len(entries) == 0 {
		t.Fatalf("entries for the deleted workspace: %+v %v", entries, err)
	}
	last := entries[0]
	if last.Op != "delete" || last.Actor != "agent:claude" {
		t.Fatalf("newest entry = %+v", last)
	}
	summary, ok := last.Detail.(map[string]any)
	if !ok || summary["nodes"] != float64(1) || summary["undoable"] != false {
		t.Fatalf("delete entry lost its summary: %+v", last.Detail)
	}
}
