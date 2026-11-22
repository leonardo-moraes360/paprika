package server

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func obj(kv ...any) *jsonv.Object { return jsonv.NewObject(kv...) }

func openTemp(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "t.db")
	s, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, path
}

func createRect(t *testing.T, s *Store, id string) {
	t.Helper()
	if _, err := s.Apply([]any{obj("op", "create", "node", obj("type", "rect", "id", id))}, "test", "criar "+id); err != nil {
		t.Fatal(err)
	}
}

func TestStorePersistsDocumentAndHistory(t *testing.T) {
	s, path := openTemp(t)
	if name := s.Doc().Str("name"); name != "t" {
		t.Fatalf("name = %q", name)
	}
	createRect(t, s, "a")
	createRect(t, s, "b")
	if _, err := s.Apply([]any{obj("op", "set_tokens", "tokens", obj("brand", "#c43d27", "size", 16.0))}, "test", "tokens"); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.Undo("test"); !ok || err != nil {
		t.Fatalf("undo: %v %v", ok, err)
	}
	want := jsonv.Stringify(s.Doc(), "  ")
	version := s.Version()
	s.Close()

	// Reopen: document, version and both undo/redo stacks survive the restart.
	s2, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	if got := jsonv.Stringify(s2.Doc(), "  "); got != want {
		t.Fatalf("doc after reopen:\n%s\nwant\n%s", got, want)
	}
	if s2.Version() != version || !s2.CanUndo() || !s2.CanRedo() {
		t.Fatalf("version/undo/redo lost: v%d undo=%v redo=%v", s2.Version(), s2.CanUndo(), s2.CanRedo())
	}
	if ok, _ := s2.Redo("test"); !ok || !core.Tokens(s2.Doc()).Has("brand") {
		t.Fatal("redo after reopen failed")
	}
	if h := s2.RecentHistory(10); len(h) != 3 || h[0].Label != "criar a" {
		t.Fatalf("history = %+v", h)
	}
	// Normalized tables are queryable with plain SQL.
	var n int
	if err := s2.DB().QueryRow(`SELECT COUNT(*) FROM nodes WHERE doc_id = ? AND type = 'rect'`, s2.DocID()).Scan(&n); err != nil || n != 2 {
		t.Fatalf("nodes table: %d %v", n, err)
	}
	var tv string
	if err := s2.DB().QueryRow(`SELECT value FROM tokens WHERE doc_id = ? AND name = 'size'`, s2.DocID()).Scan(&tv); err != nil || tv != "16" {
		t.Fatalf("tokens table: %q %v", tv, err)
	}
}

func TestStorePersistsThemeModes(t *testing.T) {
	s, path := openTemp(t)
	if _, err := s.Apply([]any{
		obj("op", "set_tokens", "tokens", obj("fg", "#111111", "bg", "#ffffff")),
		obj("op", "set_tokens", "mode", "dark", "tokens", obj("fg", "#eeeeee", "bg", "#101010")),
		obj("op", "set_tokens", "mode", "compact", "tokens", obj("gap", 4.0)),
	}, "test", "temas"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Apply([]any{obj("op", "set_tokens", "mode", "dark", "tokens", obj("bg", nil))}, "test", "sem bg escuro"); err != nil {
		t.Fatal(err)
	}
	// A live document gets `modes` appended after `nodes`; parsing puts it back in schema
	// order (after `tokens`), which is what a reload must return.
	live, err := core.ParseDocument(s.Doc())
	if err != nil {
		t.Fatal(err)
	}
	want := jsonv.Stringify(live, "  ")
	if !strings.Contains(want, `"modes"`) {
		t.Fatalf("modes missing before reopen:\n%s", want)
	}
	s.Close()

	s2, err := OpenStore(path, OpenOptions{Poll: -1})
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	if got := jsonv.Stringify(s2.Doc(), "  "); got != want {
		t.Fatalf("doc after reopen:\n%s\nwant\n%s", got, want)
	}
	var n int
	if err := s2.DB().QueryRow(`SELECT COUNT(*) FROM modes WHERE doc_id = ?`, s2.DocID()).Scan(&n); err != nil || n != 2 {
		t.Fatalf("modes table: %d %v", n, err)
	}
	// Undo after the restart brings the dark bg back, and that is stored too.
	if ok, err := s2.Undo("test"); !ok || err != nil {
		t.Fatalf("undo: %v %v", ok, err)
	}
	var dark string
	if err := s2.DB().QueryRow(`SELECT tokens FROM modes WHERE doc_id = ? AND name = 'dark'`, s2.DocID()).Scan(&dark); err != nil || !strings.Contains(dark, `"bg":"#101010"`) {
		t.Fatalf("dark mode row after undo: %q %v", dark, err)
	}
	// Export keeps the modes, and import --replace does not leave stale rows behind.
	out, err := ExportDocument(s2.DB(), s2.DocID())
	if err != nil || !strings.Contains(out, `"dark"`) {
		t.Fatalf("export: %v\n%s", err, out)
	}
}

func TestStoreFailedTransactionChangesNothing(t *testing.T) {
	s, _ := openTemp(t)
	createRect(t, s, "a")
	before, v := jsonv.Stringify(s.Doc(), ""), s.Version()
	_, err := s.Apply([]any{obj("op", "update", "id", "a", "props", obj("x", 5.0)), obj("op", "delete", "id", "zz")}, "test", "")
	if err == nil || err.Error() != `op[1]: node "zz" does not exist` {
		t.Fatalf("err = %v", err)
	}
	if jsonv.Stringify(s.Doc(), "") != before || s.Version() != v {
		t.Fatal("failed transaction changed the document")
	}
}

func TestImportExportRoundTrip(t *testing.T) {
	for _, f := range []string{"demo.paprika.json", "bezier.paprika.json"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "..", "examples", f))
		if err != nil {
			t.Fatal(err)
		}
		db, err := OpenDB(filepath.Join(t.TempDir(), "x.db"))
		if err != nil {
			t.Fatal(err)
		}
		doc, err := ImportDocument(db, raw, false)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := ImportDocument(db, raw, false); err == nil || !strings.Contains(err.Error(), "já existe") {
			t.Fatalf("second import without --replace: %v", err)
		}
		if _, err := ImportDocument(db, raw, true); err != nil {
			t.Fatal(err)
		}
		out, err := ExportDocument(db, doc.Str("id"))
		if err != nil {
			t.Fatal(err)
		}
		if out != string(raw) {
			t.Errorf("%s: export differs from the imported file", f)
		}
		db.Close()
	}
}

func TestImportRejectsInvalidDocument(t *testing.T) {
	db, err := OpenDB(filepath.Join(t.TempDir(), "x.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = ImportDocument(db, []byte(`{"format":"paprika/1","id":"x","rootIds":["a"]}`), false)
	if err == nil || err.Error() != `inconsistent document: "a" is referenced but missing` {
		t.Fatalf("err = %v", err)
	}
}

func TestStoreReloadsCommitsFromAnotherProcess(t *testing.T) {
	s, path := openTemp(t)
	other, err := OpenStore(path, OpenOptions{Poll: -1, DocID: s.DocID()})
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	events := make(chan ChangeEvent, 4)
	s.OnChange(func(e ChangeEvent) { events <- e })
	createRect(t, other, "remote")
	if changed, err := s.ReloadIfChanged(); !changed || err != nil {
		t.Fatalf("reload: %v %v", changed, err)
	}
	if core.GetNode(s.Doc(), "remote") == nil || !s.CanUndo() {
		t.Fatal("remote commit not visible")
	}
	if e := <-events; e.Kind != "reload" {
		t.Fatalf("event kind %q", e.Kind)
	}
	if changed, _ := s.ReloadIfChanged(); changed {
		t.Fatal("reload without new commits")
	}
}

func TestToolsMatchContract(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	got := m.ToolNames()
	var want []string
	for _, tl := range mcpContract.Tools {
		want = append(want, tl.(*jsonv.Object).Str("name"))
	}
	sort.Strings(got)
	sort.Strings(want)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("tools\n got %v\nwant %v", got, want)
	}
}

func callText(t *testing.T, m *MCP, name string, args *jsonv.Object) (string, bool) {
	t.Helper()
	r := m.CallTool(context.Background(), name, args, args != nil)
	var b strings.Builder
	for _, c := range r.Arr("content") {
		b.WriteString(c.(*jsonv.Object).Str("text"))
	}
	return b.String(), r.Bool("isError")
}

func TestMCPToolsAndErrors(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "text", "txt", "oops")}))
	if !isErr || out != "op[0]: unknown fields for text: txt" {
		t.Fatalf("%v %q", isErr, out)
	}
	out, _ = callText(t, m, "create_nodes", obj("index", 0.0, "nodes", []any{obj("type", "rect", "id", "a"), obj("type", "rect", "id", "b")}))
	if out != "{\n  \"created\": [\n    \"a\",\n    \"b\"\n  ],\n  \"version\": 1\n}" {
		t.Fatalf("create: %q", out)
	}
	out, _ = callText(t, m, "find_nodes", obj("type", "rect"))
	if out != "rect#a 100×100 @0,0\nrect#b 100×100 @0,0" {
		t.Fatalf("find: %q", out)
	}
	out, isErr = callText(t, m, "get_document_outline", obj("depth", 51.0))
	if !isErr || out != "MCP error -32602: Input validation error: Invalid arguments for tool get_document_outline: Too big: expected number to be <=50 at depth" {
		t.Fatalf("depth: %q", out)
	}
	out, _ = callText(t, m, "undo", nil)
	if !strings.Contains(out, `"undone": true`) {
		t.Fatalf("undo: %q", out)
	}
	out, isErr = callText(t, m, "render_screenshot", obj())
	if !isErr || !strings.Contains(out, "screenshot unavailable") {
		t.Fatalf("screenshot without browser: %q", out)
	}
	out, isErr = callText(t, m, "path_info", obj())
	if !isErr || out != "pass d or id" {
		t.Fatalf("path_info: %q", out)
	}
}

func TestMCPGetBounds(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	callText(t, m, "create_nodes", obj("nodes", []any{obj(
		"type", "frame", "id", "outer", "width", 200.0, "height", 100.0,
		"layout", obj("mode", "column", "gap", 8.0, "padding", 10.0),
		"children", []any{
			obj("type", "rect", "id", "a", "width", "fill", "height", 20.0, "fill", "#111"),
			obj("type", "rect", "id", "spin", "width", 20.0, "height", 10.0, "rotation", 90.0, "fill", "#222"),
		},
	)}))
	out, isErr := callText(t, m, "get_bounds", obj("ids", []any{"a", "spin"}))
	if isErr {
		t.Fatalf("get_bounds: %q", out)
	}
	v, err := jsonv.Parse([]byte(out))
	if err != nil {
		t.Fatal(err)
	}
	boxes := v.(*jsonv.Object).Obj("boxes")
	if boxes.Obj("a").Num("width") != 180 {
		t.Fatalf("fill width: %s", jsonv.Stringify(boxes.Obj("a"), ""))
	}
	if len(boxes.Obj("spin").Arr("corners")) != 4 {
		t.Fatalf("corners: %s", jsonv.Stringify(boxes.Obj("spin"), ""))
	}
	info, isErr := callText(t, m, "path_info", obj("d", "M40 30 L80 30 L60 70 Z"))
	if isErr {
		t.Fatalf("path_info: %q", info)
	}
	pi, _ := jsonv.Parse([]byte(info))
	o := pi.(*jsonv.Object).Obj("origin")
	if o.Num("x") != 40 || o.Num("y") != 30 {
		t.Fatalf("origin: %s", jsonv.Stringify(o, ""))
	}
}

func TestMCPGroupsAndPages(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "frame", "id", "f", "width", 300.0, "height", 200.0, "children", []any{
		obj("type", "rect", "id", "a", "x", 10.0, "y", 20.0, "width", 30.0, "height", 30.0),
		obj("type", "rect", "id", "b", "x", 60.0, "y", 40.0, "width", 30.0, "height", 30.0),
	})}))
	out, isErr := callText(t, m, "group_nodes", obj("ids", []any{"a", "b"}, "id", "g", "name", "Par"))
	if isErr || out != "{\n  \"group\": \"g\",\n  \"created\": [\n    \"g\"\n  ],\n  \"version\": 2\n}" {
		t.Fatalf("group: %q", out)
	}
	if g := core.GetNode(s.Doc(), "g"); g.Num("x") != 10 || g.Num("width") != 80 || g.Num("height") != 50 {
		t.Fatalf("group box: %s", jsonv.Stringify(g, ""))
	}
	if out, isErr = callText(t, m, "group_nodes", obj("ids", []any{"g", "f"})); !isErr || !strings.Contains(out, "same parent") {
		t.Fatalf("group error: %q", out)
	}
	out, _ = callText(t, m, "ungroup_nodes", obj("ids", []any{"g"}))
	if !strings.Contains(out, "\"released\": [\n    \"a\",\n    \"b\"\n  ]") {
		t.Fatalf("ungroup: %q", out)
	}
	out, _ = callText(t, m, "create_page", obj("id", "p2", "name", "Variações"))
	if !strings.HasPrefix(out, "{\n  \"page\": \"p2\",") {
		t.Fatalf("page: %q", out)
	}
	roots := s.Doc().Strings("rootIds")
	if len(roots) != 2 || core.GetNode(s.Doc(), roots[0]).Str("name") != "Página 1" {
		t.Fatalf("pages: %v", roots)
	}
	if out, isErr = callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "rect")})); !isErr || !strings.Contains(out, "has pages") {
		t.Fatalf("loose: %q", out)
	}
}

// fb#65, #67, #68: friction an agent hit while drawing a board.
func TestMCPAgentDefaults(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	if _, isErr := callText(t, m, "create_nodes", obj("nodes", []any{
		obj("type", "text", "id", "label", "text", "Olá"),
		obj("type", "text", "id", "para", "text", "Longo", "width", 240.0),
		obj("type", "frame", "id", "cell", "height", "hug", "children", []any{obj("type", "text", "id", "inside", "text", "x")}),
		obj("type", "shape", "id", "s1", "x", 0.0, "y", 0.0),
		obj("type", "shape", "id", "s2", "x", 300.0, "y", 0.0),
	})); isErr {
		t.Fatal("create failed")
	}
	if n := core.GetNode(s.Doc(), "label"); n.Str("width") != "hug" || n.Str("height") != "hug" {
		t.Fatalf("text without size: %s", jsonv.Stringify(n, ""))
	}
	if n := core.GetNode(s.Doc(), "para"); n.Num("width") != 240 || n.Str("height") != "hug" {
		t.Fatalf("text with width only: %s", jsonv.Stringify(n, ""))
	}
	out, _ := callText(t, m, "lint_design", obj())
	if !strings.Contains(out, "hug-without-layout") || !strings.Contains(out, `"cell"`) {
		t.Fatalf("lint: %s", out)
	}
	if _, isErr := callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "connector", "id", "c1", "from", obj("nodeId", "s1"), "to", obj("nodeId", "s2"))})); isErr {
		t.Fatal("connector failed")
	}
	out, isErr := callText(t, m, "delete_nodes", obj("ids", []any{"cell", "s1"}))
	if isErr || out != "{\n  \"deleted\": [\n    \"cell\",\n    \"inside\",\n    \"s1\",\n    \"c1\"\n  ],\n  \"version\": 3\n}" {
		t.Fatalf("delete: %q", out)
	}
}

func TestMCPComponents(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "frame", "id", "btn", "x", 10.0, "y", 10.0, "width", 100.0, "height", 40.0, "children", []any{
		obj("type", "text", "id", "lbl", "text", "OK", "width", 50.0, "height", 20.0),
	})}))
	if out, isErr := callText(t, m, "create_instance", obj("componentId", "btn")); !isErr || !strings.Contains(out, "is not a component") {
		t.Fatalf("instance of non-component: %q", out)
	}
	callText(t, m, "create_component", obj("id", "btn"))
	out, isErr := callText(t, m, "create_instance", obj("componentId", "btn", "id", "i1", "scale", 2.0, "overrides", obj("lbl", obj("text", "Enviar"))))
	if isErr || !strings.Contains(out, `"lbl": "`+core.CopyID("i1", "lbl")+`"`) {
		t.Fatalf("instance: %q", out)
	}
	i1 := core.GetNode(s.Doc(), "i1")
	if i1.Num("x") != 150 || i1.Num("width") != 200 {
		t.Fatalf("instance box: %s", jsonv.Stringify(i1, ""))
	}
	if c := core.GetNode(s.Doc(), core.CopyID("i1", "lbl")); c.Str("text") != "Enviar" || c.Num("fontSize") != 32 {
		t.Fatalf("copy: %s", jsonv.Stringify(c, ""))
	}
	if out, isErr = callText(t, m, "detach_instance", obj("ids", []any{"i1"})); isErr || core.GetNode(s.Doc(), "i1").Has("instanceOf") {
		t.Fatalf("detach: %q", out)
	}
}

func TestStdio(t *testing.T) {
	s, _ := openTemp(t)
	in := strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"set_tokens","arguments":{"tokens":{"a":"#fff"}}}}
{"jsonrpc":"2.0","id":3,"method":"resources/list"}
`)
	var out bytes.Buffer
	if err := ServeStdio(context.Background(), NewMCP(s, "agent:stdio", nil), in, &out); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 3 {
		t.Fatalf("lines: %q", lines)
	}
	if !strings.Contains(lines[0], `"protocolVersion":"2025-06-18"`) || !strings.Contains(lines[0], `"instructions":"# Paprika`) {
		t.Fatalf("initialize: %s", lines[0])
	}
	if !strings.Contains(lines[2], `"code":-32601`) {
		t.Fatalf("unknown method: %s", lines[2])
	}
	if h := s.RecentHistory(1); len(h) != 1 || h[0].Actor != "agent:t" {
		t.Fatalf("actor: %+v", h)
	}
}

func TestHTTPTransportRules(t *testing.T) {
	s, _ := openTemp(t)
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	do := func(method, path string, headers map[string]string, body string) (int, string) {
		req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		if h, ok := headers["Host"]; ok {
			req.Host = h
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b)
	}
	both := map[string]string{"Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
	if code, _ := do("POST", "/mcp", map[string]string{"Content-Type": "application/json"}, `{}`); code != 406 {
		t.Fatalf("missing Accept: %d", code)
	}
	if code, _ := do("POST", "/mcp", map[string]string{"Accept": both["Accept"], "Content-Type": "text/plain"}, `{}`); code != 415 {
		t.Fatalf("wrong content type: %d", code)
	}
	if code, _ := do("GET", "/mcp", nil, ""); code != 405 {
		t.Fatalf("GET /mcp: %d", code)
	}
	if code, _ := do("POST", "/mcp", both, `{"jsonrpc":"2.0","method":"notifications/initialized"}`); code != 202 {
		t.Fatalf("notification: %d", code)
	}
	code, body := do("POST", "/mcp", both, `[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","id":2,"method":"tools/list"}]`)
	if code != 200 || !strings.HasPrefix(body, `[{"result":{}`) {
		t.Fatalf("batch: %d %s", code, body)
	}
	if code, _ := do("GET", "/api/health", map[string]string{"Host": "evil.example:1"}, ""); code != 403 {
		t.Fatalf("evil host: %d", code)
	}
	if code, body := do("GET", "/", nil, ""); code != 200 || !strings.Contains(body, "Canvas não compilado") {
		t.Fatalf("placeholder: %d", code)
	}
	code, body = do("GET", "/api/export", nil, "")
	if code != 200 || !strings.HasPrefix(body, "{\n  \"format\": \"paprika/1\"") {
		t.Fatalf("export: %d %s", code, body)
	}
}

func TestWebSocketSync(t *testing.T) {
	s, _ := openTemp(t)
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, strings.Replace(srv.URL, "http", "ws", 1)+"/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {srv.URL}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	read := func() *jsonv.Object {
		_, data, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		v, _ := jsonv.Parse(data)
		return v.(*jsonv.Object)
	}
	if m := read(); m.Str("type") != "doc" || m.Str("kind") != "reload" {
		t.Fatalf("first message: %s", jsonv.Stringify(m, ""))
	}
	c.Write(ctx, websocket.MessageText, []byte(`{"type":"ops","reqId":"r1","label":"mover","ops":[{"op":"create","node":{"type":"rect","id":"w"}}]}`))
	if m := read(); m.Str("type") != "doc" || m.Str("actor") != "user" || m.Str("label") != "mover" {
		t.Fatalf("broadcast: %s", jsonv.Stringify(m, ""))
	}
	if m := read(); m.Str("type") != "ack" || m.Str("reqId") != "r1" {
		t.Fatalf("ack: %s", jsonv.Stringify(m, ""))
	}
	c.Write(ctx, websocket.MessageText, []byte(`{"type":"bogus"}`))
	if m := read(); m.Str("type") != "error" || !strings.Contains(m.Str("message"), "Invalid discriminator value") || m.Has("reqId") {
		t.Fatalf("error: %s", jsonv.Stringify(m, ""))
	}
}

func TestMCPImportExportSVG(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	out, isErr := callText(t, m, "import_svg", obj("svg", `<svg viewBox="0 0 10 10" width="20" height="20"><path d="M0 0 L10 0 L5 8 Z" fill="#c43d27"/><text>x</text></svg>`, "x", 5.0, "y", 5.0, "name", "Seta"))
	if isErr || !strings.Contains(out, `"warnings": [`+"\n"+`    "<text> is not imported"`) {
		t.Fatalf("import_svg: %q", out)
	}
	var created string
	for _, id := range core.Nodes(s.Doc()).Keys() {
		created = id
	}
	n := core.GetNode(s.Doc(), created)
	if n.Str("d") != "M0 0 L20 0 L10 16 Z" || n.Str("name") != "Seta" || n.Num("x") != 5 {
		t.Fatalf("imported path: %s", jsonv.Stringify(n, ""))
	}
	if out, isErr := callText(t, m, "import_svg", obj("svg", "<svg></svg>")); !isErr || out != "the SVG has no shapes to import" {
		t.Fatalf("empty svg: %q", out)
	}
	if out, isErr := callText(t, m, "import_html", obj("html", `<div style="display:flex; gap:8px"><span>Olá</span></div>`, "label", "colar")); isErr || !strings.Contains(out, `"created"`) {
		t.Fatalf("import_html: %q", out)
	}
	if out, isErr := callText(t, m, "export_code", obj("rootId", created, "format", "svg")); isErr || !strings.Contains(out, "<svg xmlns=") || !strings.Contains(out, `data-paprika-id="`+created+`"`) {
		t.Fatalf("export svg without browser: %q", out)
	}
}

func TestMCPExportTailwindAndCSSModules(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	if _, isErr := callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "frame", "id", "card", "name", "Card grande", "width", 120.0, "height", 80.0, "fill", "#ffffff",
		"children", []any{obj("type", "text", "id", "t", "text", "Olá", "fontSize", 16.0)})})); isErr {
		t.Fatal("create_nodes")
	}
	tw, isErr := callText(t, m, "export_code", obj("rootId", "card", "format", "tailwind"))
	if isErr || !strings.Contains(tw, "export function CardGrande()") || !strings.Contains(tw, `className="`) || strings.Contains(tw, "style={{") {
		t.Fatalf("tailwind: %q", tw)
	}
	twh, isErr := callText(t, m, "export_code", obj("rootId", "card", "format", "tailwind-html"))
	if isErr || !strings.Contains(twh, "@tailwindcss/browser") || !strings.Contains(twh, ` class="`) || strings.Contains(twh, ` style="`) {
		t.Fatalf("tailwind-html: %q", twh)
	}
	r := m.CallTool(context.Background(), "export_code", obj("rootId", "card", "format", "css-modules", "cssVariables", true), true)
	content := r.Arr("content")
	if r.Bool("isError") || len(content) != 2 {
		t.Fatalf("css-modules: %s", jsonv.Stringify(r, ""))
	}
	tsx, css := content[0].(*jsonv.Object).Str("text"), content[1].(*jsonv.Object).Str("text")
	if !strings.HasPrefix(tsx, "// CardGrande.tsx\nimport styles from \"./CardGrande.module.css\";") || !strings.Contains(tsx, "className={styles.cardGrande}") {
		t.Fatalf("css-modules component: %q", tsx)
	}
	if !strings.HasPrefix(css, "/* CardGrande.module.css */\n:root{") || !strings.Contains(css, ".cardGrande{box-sizing:border-box;") {
		t.Fatalf("css-modules sheet: %q", css)
	}
	for _, format := range []string{"tailwind", "tailwind-html", "css-modules"} {
		if out, isErr := callText(t, m, "export_code", obj("rootId", "nope", "format", format)); !isErr || out != `node "nope" does not exist` {
			t.Fatalf("%s missing node: %q", format, out)
		}
	}
}

func TestPresence(t *testing.T) {
	s, _ := openTemp(t)
	var got []Presence
	stop := s.Presence.OnPresence(func(p Presence) { got = append(got, p) })
	defer stop()
	in := strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_nodes","arguments":{"nodes":[{"type":"rect","id":"p1"}]}}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_nodes","arguments":{"ids":["p1","zz"]}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_nodes","arguments":{"ids":"bad"}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"undo"}}
`)
	var out bytes.Buffer
	if err := ServeStdio(context.Background(), NewMCP(s, "agent:stdio", nil), in, &out); err != nil {
		t.Fatal(err)
	}
	// The invalid call never reached its handler: no presence (same as the TS SDK).
	if len(got) != 3 {
		t.Fatalf("presences: %+v", got)
	}
	if m := got[0].Message(); m != `{"type":"presence","agent":"agent:t","actor":"agent:t","tool":"create_nodes","nodes":["p1"],"idle":0}` {
		t.Fatalf("message: %s", m)
	}
	if got[1].Tool != "get_nodes" || len(got[1].Nodes) != 1 || got[2].Tool != "undo" || len(got[2].Nodes) != 0 {
		t.Fatalf("presences: %+v", got)
	}
	if k := PresenceKey("abc", "agent:t"); !strings.HasPrefix(k, "s:") || len(k) != 14 {
		t.Fatalf("key: %s", k)
	}

	now := time.Unix(1000, 0)
	h := NewPresenceHub(func() time.Time { return now })
	for i := range 70 {
		h.Report("k"+strconv.Itoa(i), "agent:x", "get_nodes", nil)
	}
	h.Report("k6", "agent:x", "get_nodes", nil) // moves k6 to the end
	if r := h.Recent(); len(r) != 64 || r[0].Agent != "k7" || r[63].Agent != "k6" {
		t.Fatalf("recent: %d %s %s", len(r), r[0].Agent, r[len(r)-1].Agent)
	}
	now = now.Add(PresenceTTL)
	if r := h.Recent(); len(r) != 0 {
		t.Fatalf("ttl: %d", len(r))
	}
}

func TestMCPDuplicateNodes(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	callText(t, m, "set_tokens", obj("tokens", obj("bg", "#ffffff", "fg", "#1e2336")))
	callText(t, m, "set_tokens", obj("mode", "dark", "tokens", obj("bg", "#14161f", "fg", "#f2f2f2")))
	callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "frame", "id", "board", "name", "Board", "x", 0.0, "y", 0.0, "width", 300.0, "height", 120.0, "fill", "$bg", "children", []any{
		obj("type", "shape", "id", "a", "x", 10.0, "y", 10.0, "width", 80.0, "height", 40.0, "text", "A", "color", "$fg", "fill", "$bg"),
		obj("type", "shape", "id", "b", "x", 150.0, "y", 10.0, "width", 80.0, "height", 40.0, "text", "B", "color", "$fg", "fill", "$bg"),
		obj("type", "connector", "id", "ab", "from", obj("nodeId", "a"), "to", obj("nodeId", "b")),
	})}))
	before := s.Version()

	r := m.CallTool(context.Background(), "duplicate_nodes", obj("ids", []any{"board"}, "offset", 340.0, "props", obj("mode", "dark", "name", "Board dark")), true)
	if r.Bool("isError") {
		t.Fatalf("duplicate: %s", jsonv.Stringify(r, ""))
	}
	sc := r.Obj("structuredContent")
	copies := sc.Strings("copies")
	if len(copies) != 1 || sc.Obj("map").Len() != 4 || len(sc.Strings("created")) != 4 || s.Version() != before+1 {
		t.Fatalf("result: %s (version %d, before %d)", jsonv.Stringify(sc, ""), s.Version(), before)
	}
	copy := core.GetNode(s.Doc(), copies[0])
	if copy.Str("mode") != "dark" || copy.Str("name") != "Board dark" || copy.Num("x") != 340 || copy.Num("y") != 340 {
		t.Fatalf("copy: %s", jsonv.Stringify(copy, ""))
	}
	conn := core.GetNode(s.Doc(), sc.Obj("map").Str("ab"))
	if conn.Obj("from").Str("nodeId") != sc.Obj("map").Str("a") || conn.Obj("to").Str("nodeId") != sc.Obj("map").Str("b") {
		t.Fatalf("connector not re-pointed: %s", jsonv.Stringify(conn, ""))
	}
	if out, isErr := callText(t, m, "lint_design", obj()); isErr || !strings.Contains(out, `"issues": []`) {
		t.Fatalf("lint: %q", out)
	}

	callText(t, m, "undo", obj())
	if core.GetNode(s.Doc(), copies[0]) != nil || core.Nodes(s.Doc()).Len() != 4 {
		t.Fatalf("undo did not remove the whole copy: %d nodes", core.Nodes(s.Doc()).Len())
	}

	for _, c := range []struct {
		args *jsonv.Object
		want string
	}{
		{obj("ids", []any{"nope"}), "nodes do not exist: nope"},
		{obj("ids", []any{"board"}, "scale", 0.0), "scale"},
		{obj("ids", []any{"board"}, "props", obj("id", "x")), "props cannot set id"},
		{obj("ids", []any{"board"}, "parentId", "nope"), `parent "nope" does not exist`},
	} {
		if out, isErr := callText(t, m, "duplicate_nodes", c.args); !isErr || !strings.Contains(out, c.want) {
			t.Fatalf("error %s: %q", c.want, out)
		}
	}
}
