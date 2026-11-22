package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func httpDo(t *testing.T, srv *RunningServer, method, path string, headers map[string]string, body string) (int, string, http.Header) {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
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
	return res.StatusCode, string(b), res.Header
}

func TestHTTPRouteTable(t *testing.T) {
	s, _ := openTemp(t)
	ws, err := s.CreateWorkspace("outro", "user")
	if err != nil {
		t.Fatal(err)
	}
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	type row struct {
		method string
		path   string
		body   string
		status int
		errSub string
		okJSON bool
	}
	rows := []row{
		{"GET", "/api/health", "", 200, "", true},
		{"POST", "/api/health", "", 405, "método não permitido", true},
		{"GET", "/api/document", "", 200, "", true},
		{"POST", "/api/document", "", 405, "método não permitido", true},
		{"POST", "/api/ops", `{"ops":[{"op":"create","node":{"type":"rect","id":"r1"}}]}`, 200, "", true},
		{"POST", "/api/ops", `{`, 400, "JSON inválido", true},
		{"GET", "/api/ops", "", 405, "método não permitido", true},
		{"GET", "/api/export", "", 200, "", false},
		{"POST", "/api/export", "", 405, "método não permitido", true},
		{"GET", "/api/workspaces", "", 200, "", true},
		{"POST", "/api/workspaces", `{"name":"novo"}`, 201, "", true},
		{"POST", "/api/workspaces", `{`, 400, "JSON inválido", true},
		{"PUT", "/api/workspaces", "", 405, "método não permitido", true},
		{"PATCH", "/api/workspaces/" + ws.ID, `{"name":"renomeado"}`, 200, "", true},
		{"PATCH", "/api/workspaces/missing", `{"name":"x"}`, 404, "não existe", true},
		{"PATCH", "/api/workspaces/" + ws.ID, `{"name":"   "}`, 400, "não pode ficar vazio", true},
		{"DELETE", "/api/workspaces/missing", "", 404, "não existe", true},
		{"GET", "/api/workspaces/" + ws.ID, "", 405, "método não permitido", true},
		{"GET", "/api/workspaces/missing/cover", "", 404, "não tem capa", true},
		{"PUT", "/api/workspaces/missing/cover", "not-an-image", 415, "PNG, JPEG, WebP ou GIF", true},
		{"DELETE", "/api/workspaces/missing/cover", "", 404, "não existe", true},
		{"POST", "/api/workspaces/missing/cover", "", 405, "método não permitido", true},
		{"POST", "/api/workspaces/" + ws.ID + "/open", "", 200, "", true},
		{"POST", "/api/workspaces/missing/open", "", 404, "não existe", true},
		{"GET", "/api/workspaces/" + ws.ID + "/open", "", 405, "método não permitido", true},
		{"GET", "/api/render", "", 200, "", false},
		{"POST", "/api/render", "", 405, "método não permitido", true},
		{"GET", "/api/screenshot", "", 500, "screenshot indisponível", true},
		{"POST", "/api/screenshot", "", 405, "método não permitido", true},
		{"GET", "/api/screenshot/missing", "", 404, "screenshot não encontrado", true},
		{"GET", "/api/svg", "", 200, "", true},
		{"POST", "/api/svg", "", 405, "método não permitido", true},
		{"GET", "/", "", 200, "", false},
		{"POST", "/no-such", "", 405, "método não permitido", true},
		{"GET", "/mcp", "", 405, "", false},
		{"POST", "/mcp", `{}`, 406, "", false},
	}

	for _, r := range rows {
		headers := map[string]string{}
		if r.method == "POST" && strings.HasPrefix(r.path, "/mcp") {
			headers["Content-Type"] = "application/json"
		} else if r.body != "" && !strings.HasPrefix(r.path, "/api/workspaces/") || strings.Contains(r.path, "/cover") && r.method == "PUT" {
			if r.method == "POST" || r.method == "PATCH" {
				headers["Content-Type"] = "application/json"
			}
		} else if r.method == "POST" || r.method == "PATCH" {
			headers["Content-Type"] = "application/json"
		}
		code, body, _ := httpDo(t, srv, r.method, r.path, headers, r.body)
		if code != r.status {
			t.Fatalf("%s %s: status %d want %d body=%s", r.method, r.path, code, r.status, body)
		}
		if r.errSub != "" && !strings.Contains(body, r.errSub) {
			t.Fatalf("%s %s: body %q missing %q", r.method, r.path, body, r.errSub)
		}
		if r.okJSON && r.status >= 400 {
			var m map[string]any
			if err := json.Unmarshal([]byte(body), &m); err != nil {
				t.Fatalf("%s %s: not JSON error body: %s", r.method, r.path, body)
			}
			if _, ok := m["error"]; !ok && r.errSub != "" {
				t.Fatalf("%s %s: missing error field: %s", r.method, r.path, body)
			}
		}
	}
}

func TestHTTPHostOriginOn404AndPanic(t *testing.T) {
	s, _ := openTemp(t)
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	code, body, _ := httpDo(t, srv, "GET", "/api/health", map[string]string{"Host": "evil.example:" + strconv.Itoa(srv.Port)}, "")
	if code != 403 || !strings.Contains(body, "Host/Origin não permitido") {
		t.Fatalf("evil host health: %d %s", code, body)
	}
	code, body, _ = httpDo(t, srv, "GET", "/definitely-missing-asset.js", map[string]string{"Host": "evil.example:" + strconv.Itoa(srv.Port)}, "")
	if code != 403 || !strings.Contains(body, "Host/Origin não permitido") {
		t.Fatalf("evil host 404 path: %d %s", code, body)
	}
	code, body, _ = httpDo(t, srv, "GET", "/api/health", map[string]string{"Origin": "http://evil.example:" + strconv.Itoa(srv.Port)}, "")
	if code != 403 || !strings.Contains(body, "Host/Origin não permitido") {
		t.Fatalf("evil origin: %d %s", code, body)
	}
}

func BenchmarkGETWorkspaces(b *testing.B) {
	s, err := OpenStore(b.TempDir()+"/b.db", OpenOptions{Poll: -1})
	if err != nil {
		b.Fatal(err)
	}
	defer s.Close()
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0})
	if err != nil {
		b.Fatal(err)
	}
	defer srv.Close()
	client := &http.Client{Timeout: 5 * time.Second}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		res, err := client.Get(srv.URL + "/api/workspaces")
		if err != nil {
			b.Fatal(err)
		}
		io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if res.StatusCode != 200 {
			b.Fatalf("status %d", res.StatusCode)
		}
	}
}

func BenchmarkMCPToolsCall(b *testing.B) {
	s, err := OpenStore(b.TempDir()+"/b.db", OpenOptions{Poll: -1})
	if err != nil {
		b.Fatal(err)
	}
	defer s.Close()
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0})
	if err != nil {
		b.Fatal(err)
	}
	defer srv.Close()
	client := &http.Client{Timeout: 5 * time.Second}
	payload := `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_workspaces","arguments":{}}}`
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req, _ := http.NewRequest("POST", srv.URL+"/mcp", strings.NewReader(payload))
		req.Header.Set("Accept", "application/json, text/event-stream")
		req.Header.Set("Content-Type", "application/json")
		res, err := client.Do(req)
		if err != nil {
			b.Fatal(err)
		}
		io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if res.StatusCode != 200 {
			b.Fatalf("status %d", res.StatusCode)
		}
	}
}

func TestWorkspaceOpsBroadcast(t *testing.T) {
	s, _ := openTemp(t)
	before, err := s.CreateWorkspace("antes", "user")
	if err != nil {
		t.Fatal(err)
	}
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
	next := func() *jsonv.Object {
		t.Helper()
		for {
			_, data, err := c.Read(ctx)
			if err != nil {
				t.Fatal(err)
			}
			v, _ := jsonv.Parse(data)
			if m := v.(*jsonv.Object); m.Str("type") == "workspaceOp" {
				op, _ := m.Get("op")
				return op.(*jsonv.Object)
			}
		}
	}
	if _, err := s.DeleteWorkspace(s.DocID(), "agent:claude-code"); err != nil {
		t.Fatal(err)
	}
	opened := next()
	if opened.Str("op") != "open" || opened.Str("actor") != "agent:claude-code" || opened.Str("workspaceId") != before.ID {
		t.Fatalf("first op: %s", jsonv.Stringify(opened, ""))
	}
	deleted := next()
	raw, _ := deleted.Get("detail")
	detail, _ := raw.(*jsonv.Object)
	if deleted.Str("op") != "delete" || detail == nil || detail.Str("successor") != before.ID || detail.Bool("active") != true {
		t.Fatalf("second op: %s", jsonv.Stringify(deleted, ""))
	}
}
