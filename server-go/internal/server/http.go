package server

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/coder/websocket"
	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	z "github.com/leonardo-moraes360/paprika/server-go/internal/zod"
)

// HTTPOptions configure the HTTP/WS server.
type HTTPOptions struct {
	Host    string
	Port    int
	WebRoot string // build of the canvas (apps/web/dist); empty serves a placeholder page
	Log     func(string)
	Shot    Screenshotter
}

var mimeTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".svg":   "image/svg+xml",
	".png":   "image/png",
	".ico":   "image/x-icon",
	".json":  "application/json",
	".woff2": "font/woff2",
}

const maxBody = 8 * 1024 * 1024

func isLoopbackHost(h string) bool { return h == "127.0.0.1" || h == "localhost" || h == "::1" }

// AllowedRequest blocks DNS rebinding and CSRF: on a loopback bind only local Host/Origin pass;
// when bound elsewhere (--host), the configured host is accepted too.
func AllowedRequest(r *http.Request, bindHost string, port int) bool {
	p := strconv.Itoa(port)
	allowed := map[string]bool{"127.0.0.1:" + p: true, "localhost:" + p: true, "[::1]:" + p: true}
	if !isLoopbackHost(bindHost) {
		allowed[bindHost+":"+p] = true
	}
	if r.Host == "" || !allowed[r.Host] {
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Host == "" || !allowed[u.Host] {
			return false
		}
	}
	return true
}

type httpError struct {
	status int
	msg    string
}

func (e *httpError) Error() string { return e.msg }

func readBody(r *http.Request) (any, bool, error) {
	data, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil {
		return nil, false, err
	}
	if len(data) > maxBody {
		return nil, false, &httpError{413, "corpo excede 8 MiB"}
	}
	if len(data) == 0 {
		return nil, false, nil
	}
	v, err := jsonv.Parse(data)
	if err != nil {
		return nil, false, &httpError{400, "JSON inválido"}
	}
	return v, true, nil
}

func send(w http.ResponseWriter, status int, body any, contentType string) {
	if contentType == "" {
		contentType = "application/json"
	}
	h := w.Header()
	h.Set("content-type", contentType)
	h.Set("cache-control", "no-store")
	h.Set("x-content-type-options", "nosniff")
	w.WriteHeader(status)
	switch b := body.(type) {
	case string:
		io.WriteString(w, b)
	case []byte:
		w.Write(b)
	default:
		io.WriteString(w, jsonv.Stringify(jsonv.FromGo(body), ""))
	}
}

func errBody(msg string) *jsonv.Object { return jsonv.NewObject("error", msg) }

// Client → server messages over WebSocket.
var clientMessage = z.DiscriminatedUnion("type",
	z.Option("ops", z.Object(
		z.Field{Name: "type", Schema: z.Literal("ops")},
		z.Field{Name: "ops", Schema: z.Array(core.OpSchema).Min(1)},
		z.Field{Name: "label", Schema: z.Optional(z.String().Max(200))},
		z.Field{Name: "reqId", Schema: z.Optional(z.String())},
	)),
	z.Option("undo", z.Object(z.Field{Name: "type", Schema: z.Literal("undo")}, z.Field{Name: "reqId", Schema: z.Optional(z.String())})),
	z.Option("redo", z.Object(z.Field{Name: "type", Schema: z.Literal("redo")}, z.Field{Name: "reqId", Schema: z.Optional(z.String())})),
)

var apiOpsBody = z.Object(
	z.Field{Name: "ops", Schema: z.Array(core.OpSchema).Min(1)},
	z.Field{Name: "label", Schema: z.Optional(z.String())},
	z.Field{Name: "actor", Schema: z.Optional(z.String().Max(100))},
)

// RunningServer is a started HTTP server.
type RunningServer struct {
	URL    string
	Port   int
	server *http.Server
	ln     net.Listener
	close  func()
}

// Close stops the server and its WebSocket connections.
func (s *RunningServer) Close() error {
	s.close()
	return s.server.Close()
}

type wsHub struct {
	mu    sync.Mutex
	conns map[*websocket.Conn]chan string
}

// StartHTTP serves the canvas, the API, MCP over Streamable HTTP (/mcp) and live sync (/ws).
func StartHTTP(store *Store, opts HTTPOptions) (*RunningServer, error) {
	logf := opts.Log
	if logf == nil {
		logf = func(string) {}
	}
	webRoot := ""
	if opts.WebRoot != "" {
		if st, err := os.Stat(opts.WebRoot); err == nil && st.IsDir() {
			webRoot, _ = filepath.Abs(opts.WebRoot)
		}
	}
	ln, err := net.Listen("tcp", net.JoinHostPort(opts.Host, strconv.Itoa(opts.Port)))
	if err != nil {
		return nil, err
	}
	port := ln.Addr().(*net.TCPAddr).Port

	hub := &wsHub{conns: map[*websocket.Conn]chan string{}}
	docMessage := func(doc *core.Document, version int64, actor, label, kind string, canUndo, canRedo bool) string {
		return jsonv.Stringify(jsonv.NewObject("type", "doc", "doc", doc, "version", float64(version), "actor", actor, "label", label,
			"kind", kind, "canUndo", canUndo, "canRedo", canRedo), "")
	}
	unsubscribe := store.OnChange(func(e ChangeEvent) {
		msg := docMessage(e.Doc, e.Version, e.Actor, e.Label, e.Kind, store.CanUndo(), store.CanRedo())
		hub.mu.Lock()
		for _, ch := range hub.conns {
			select {
			case ch <- msg:
			default: // slow client: drop; it gets the full document on the next change
			}
		}
		hub.mu.Unlock()
	})

	mux := http.NewServeMux()
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if p := recover(); p != nil {
				logf(fmt.Sprintf("erro HTTP: %v", p))
				send(w, 500, errBody(fmt.Sprint(p)), "")
			}
		}()
		if !AllowedRequest(r, opts.Host, port) {
			if r.URL.Path == "/ws" && strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			send(w, 403, errBody("Host/Origin não permitido"), "")
			return
		}
		mux.ServeHTTP(w, r)
	})

	mux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		ua := r.Header.Get("User-Agent")
		if ua == "" {
			ua = "http"
		}
		actor := "agent:" + strings.SplitN(ua, "/", 2)[0]
		serveMCPHTTP(w, r, NewMCP(store, actor, opts.Shot))
	})
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		send(w, 200, jsonv.NewObject("ok", true, "version", float64(store.Version()), "file", store.Path(), "storage", "sqlite", "docId", store.DocID()), "")
	})
	mux.HandleFunc("/api/document", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			send(w, 405, errBody("método não permitido"), "")
			return
		}
		doc, version, _, _ := store.Snapshot()
		send(w, 200, jsonv.NewObject("doc", doc, "version", float64(version)), "")
	})
	mux.HandleFunc("/api/ops", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			send(w, 405, errBody("método não permitido"), "")
			return
		}
		body, present, err := readBody(r)
		if err != nil {
			var he *httpError
			if errors.As(err, &he) {
				send(w, he.status, errBody(he.msg), "")
				return
			}
			send(w, 500, errBody(err.Error()), "")
			return
		}
		var parsed any
		if present {
			parsed, err = z.Parse(apiOpsBody, body)
		} else {
			_, _, err = z.ParseUndefined(apiOpsBody)
		}
		if err != nil {
			send(w, 400, errBody(err.Error()), "")
			return
		}
		b := parsed.(*jsonv.Object)
		actor := "api"
		if b.Has("actor") {
			actor = b.Str("actor")
		}
		res, err := store.Apply(b.Arr("ops"), actor, b.Str("label"))
		if err != nil {
			send(w, 422, errBody(err.Error()), "")
			return
		}
		send(w, 200, jsonv.NewObject("created", jsonv.FromGo(res.Created), "version", float64(store.Version())), "")
	})
	mux.HandleFunc("/api/export", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			send(w, 405, errBody("método não permitido"), "")
			return
		}
		w.Header().Set("content-disposition", `attachment; filename="`+safeFileName(store.Doc().Str("name"))+`.paprika.json"`)
		send(w, 200, jsonv.Stringify(store.Doc(), "  ")+"\n", "application/json")
	})
	mux.HandleFunc("/api/render", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			send(w, 405, errBody("método não permitido"), "")
			return
		}
		html, _, err := core.RenderHTML(store.Doc(), core.RenderOptions{RootID: r.URL.Query().Get("root")})
		if err != nil {
			send(w, 500, errBody(err.Error()), "")
			return
		}
		send(w, 200, html, mimeTypes[".html"])
	})
	mux.HandleFunc("/api/screenshot", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			send(w, 405, errBody("método não permitido"), "")
			return
		}
		if opts.Shot == nil {
			send(w, 500, errBody("screenshot indisponível neste servidor"), "")
			return
		}
		scale, _ := strconv.ParseFloat(r.URL.Query().Get("scale"), 64)
		if scale == 0 {
			scale = 1
		}
		png, _, _, err := opts.Shot.Screenshot(r.Context(), store.Doc(), r.URL.Query().Get("root"), scale)
		if err != nil {
			logf("erro HTTP: " + err.Error())
			send(w, 500, errBody(err.Error()), "")
			return
		}
		send(w, 200, png, "image/png")
	})
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		// Host/Origin were validated above; the library's own origin check is redundant.
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		conn.SetReadLimit(maxBody)
		serveWS(r.Context(), conn, store, hub, docMessage)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			send(w, 405, errBody("método não permitido"), "")
			return
		}
		serveStatic(w, r, webRoot)
	})

	srv := &http.Server{Handler: handler}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logf("erro HTTP: " + err.Error())
		}
	}()
	hostForURL := opts.Host
	if strings.Contains(hostForURL, ":") {
		hostForURL = "[" + hostForURL + "]"
	}
	return &RunningServer{
		URL:    fmt.Sprintf("http://%s:%d", hostForURL, port),
		Port:   port,
		server: srv,
		ln:     ln,
		close: func() {
			unsubscribe()
			hub.mu.Lock()
			for c := range hub.conns {
				c.CloseNow()
			}
			hub.mu.Unlock()
		},
	}, nil
}

func safeFileName(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || strings.ContainsRune(`/\:*?"<>|`, r) {
			return '-'
		}
		return r
	}, s)
	if s == "" {
		return "design"
	}
	return s
}

func serveStatic(w http.ResponseWriter, r *http.Request, webRoot string) {
	if webRoot == "" {
		send(w, 200, `<!doctype html><meta charset="utf-8"><title>Paprika</title><p>Canvas não compilado. Rode <code>pnpm build</code>. MCP ativo em <code>/mcp</code>.</p>`, mimeTypes[".html"])
		return
	}
	rel, err := url.PathUnescape(r.URL.EscapedPath())
	if err != nil {
		send(w, 403, errBody("caminho proibido"), "")
		return
	}
	rel = strings.TrimLeft(path.Clean("/"+rel), "/")
	file := filepath.Join(webRoot, filepath.FromSlash(rel))
	if file != webRoot && !strings.HasPrefix(file, webRoot+string(filepath.Separator)) {
		send(w, 403, errBody("caminho proibido"), "")
		return
	}
	if st, err := os.Stat(file); err != nil || st.IsDir() {
		file = filepath.Join(webRoot, "index.html")
	}
	data, err := os.ReadFile(file)
	if err != nil {
		send(w, 500, errBody(err.Error()), "")
		return
	}
	ct := mimeTypes[filepath.Ext(file)]
	if ct == "" {
		ct = mime.TypeByExtension(filepath.Ext(file))
	}
	if ct == "" {
		ct = "application/octet-stream"
	}
	send(w, 200, data, ct)
}

func serveWS(ctx context.Context, conn *websocket.Conn, store *Store, hub *wsHub,
	docMessage func(*core.Document, int64, string, string, string, bool, bool) string) {
	out := make(chan string, 64)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	doc, version, cu, cr := store.Snapshot()
	out <- docMessage(doc, version, "server", "", "reload", cu, cr)
	hub.mu.Lock()
	hub.conns[conn] = out
	hub.mu.Unlock()
	defer func() {
		hub.mu.Lock()
		delete(hub.conns, conn)
		hub.mu.Unlock()
		conn.CloseNow()
	}()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case m := <-out:
				if err := conn.Write(ctx, websocket.MessageText, []byte(m)); err != nil {
					cancel()
					return
				}
			}
		}
	}()
	reply := func(o *jsonv.Object) {
		select {
		case out <- jsonv.Stringify(o, ""):
		case <-ctx.Done():
		}
	}
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var reqID any
		hasReq := false
		fail := func(msg string) {
			o := jsonv.NewObject("type", "error")
			if hasReq {
				o.Set("reqId", reqID)
			}
			o.Set("message", msg)
			reply(o)
		}
		raw, err := jsonv.Parse(data)
		if err != nil {
			fail(jsParseError(data))
			continue
		}
		parsed, err := z.Parse(clientMessage, raw)
		if err != nil {
			fail(err.Error())
			continue
		}
		msg := parsed.(*jsonv.Object)
		reqID, hasReq = msg.Get("reqId")
		switch msg.Str("type") {
		case "ops":
			_, err = store.Apply(msg.Arr("ops"), "user", msg.Str("label"))
		case "undo":
			_, err = store.Undo("user")
		default:
			_, err = store.Redo("user")
		}
		if err != nil {
			fail(err.Error())
			continue
		}
		if hasReq {
			reply(jsonv.NewObject("type", "ack", "reqId", reqID, "version", float64(store.Version())))
		}
	}
}

// jsParseError approximates JSON.parse's SyntaxError message.
func jsParseError(data []byte) string {
	s := string(data)
	if len(s) > 40 {
		s = s[:40] + "..."
	}
	return fmt.Sprintf(`Unexpected token in JSON: "%s" is not valid JSON`, s)
}

// ---- MCP over Streamable HTTP (stateless, JSON responses) ----

func jsonRPCHTTPError(w http.ResponseWriter, status, code int, msg string, extra map[string]string) {
	for k, v := range extra {
		w.Header().Set(k, v)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	io.WriteString(w, jsonv.Stringify(jsonv.NewObject("jsonrpc", "2.0", "error", jsonv.NewObject("code", float64(code), "message", msg), "id", nil), ""))
}

func serveMCPHTTP(w http.ResponseWriter, r *http.Request, m *MCP) {
	switch r.Method {
	case http.MethodPost:
	case http.MethodGet, http.MethodDelete:
		// Stateless server: no standalone SSE stream and no sessions to delete.
		jsonRPCHTTPError(w, 405, -32000, "Method not allowed.", map[string]string{"Allow": "POST"})
		return
	default:
		jsonRPCHTTPError(w, 405, -32000, "Method not allowed.", map[string]string{"Allow": "GET, POST, DELETE"})
		return
	}
	accept := r.Header.Get("Accept")
	if !strings.Contains(accept, "application/json") || !strings.Contains(accept, "text/event-stream") {
		jsonRPCHTTPError(w, 406, -32000, "Not Acceptable: Client must accept both application/json and text/event-stream", nil)
		return
	}
	if mt, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type")); mt != "application/json" {
		jsonRPCHTTPError(w, 415, -32000, "Unsupported Media Type: Content-Type must be application/json", nil)
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil || len(data) > maxBody {
		jsonRPCHTTPError(w, 413, -32000, "Payload Too Large", nil)
		return
	}
	raw, err := jsonv.Parse(data)
	if err != nil {
		jsonRPCHTTPError(w, 400, codeParseError, "Parse error: Invalid JSON", nil)
		return
	}
	batch, isBatch := raw.([]any)
	if !isBatch {
		batch = []any{raw}
	}
	hasInit := false
	for _, msg := range batch {
		o, ok := msg.(*jsonv.Object)
		if !ok || o.Str("jsonrpc") != "2.0" {
			jsonRPCHTTPError(w, 400, codeParseError, "Parse error: Invalid JSON-RPC message", nil)
			return
		}
		if o.Str("method") == "initialize" {
			hasInit = true
		}
	}
	if hasInit && len(batch) > 1 {
		jsonRPCHTTPError(w, 400, codeInvalidRequest, "Invalid Request: Only one initialization request is allowed", nil)
		return
	}
	if v := r.Header.Get("Mcp-Protocol-Version"); v != "" && !hasInit {
		ok := false
		for _, s := range supportedProtocolVersions {
			ok = ok || s == v
		}
		if !ok {
			jsonRPCHTTPError(w, 400, -32000, fmt.Sprintf("Bad Request: Unsupported protocol version: %s (supported versions: %s)", v, strings.Join(supportedProtocolVersions, ", ")), nil)
			return
		}
	}
	var responses []any
	for _, msg := range batch {
		if res := m.Handle(r.Context(), msg); res != nil {
			responses = append(responses, res)
		}
	}
	if len(responses) == 0 {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	if isBatch {
		io.WriteString(w, jsonv.Stringify(responses, ""))
		return
	}
	io.WriteString(w, jsonv.Stringify(responses[0], ""))
}

// ---- MCP over stdio (newline-delimited JSON-RPC) ----

// ServeStdio reads JSON-RPC messages from in and writes responses to out until in closes.
func ServeStdio(ctx context.Context, m *MCP, in io.Reader, out io.Writer) error {
	sc := bufio.NewScanner(in)
	sc.Buffer(make([]byte, 64*1024), maxBody+1024)
	var wmu sync.Mutex
	write := func(o *jsonv.Object) {
		wmu.Lock()
		defer wmu.Unlock()
		io.WriteString(out, jsonv.Stringify(o, "")+"\n")
	}
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		raw, err := jsonv.Parse([]byte(line))
		if err != nil {
			write(rpcError(nil, codeParseError, "Parse error"))
			continue
		}
		if res := m.Handle(ctx, raw); res != nil {
			write(res)
		}
	}
	return sc.Err()
}
