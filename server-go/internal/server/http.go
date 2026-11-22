package server

import (
	"bufio"
	"context"
	"crypto/rand"
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
	"github.com/gin-gonic/gin"
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
	// Team is the team sync service (ADR 0004); nil when the instance is not in a team.
	Team TeamRoutes
}

// TeamRoutes is what the HTTP server needs from the team package (which imports this one).
type TeamRoutes interface {
	Routes(r gin.IRoutes)
	// Recent returns the WebSocket messages a canvas that just connected needs.
	Recent() []string
	// OnMessage subscribes to WebSocket messages for every canvas; returns the unsubscribe.
	OnMessage(fn func(string)) func()
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
	".wasm":  "application/wasm",
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

// POST /api/workspaces: name of the new workspace (blank: "Sem título").
var workspaceBody = z.Object(z.Field{Name: "name", Schema: z.Optional(z.String().Max(120))})

// PATCH /api/workspaces/{id}: new name (trimmed, not blank).
var renameWorkspaceBody = z.Object(z.Field{Name: "name", Schema: z.String().Max(120)})

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

	unsubscribePresence := store.Presence.OnPresence(func(p Presence) {
		msg := p.Message()
		hub.mu.Lock()
		for _, ch := range hub.conns {
			select {
			case ch <- msg:
			default: // slow client: drop; the next tool call moves the cursor again
			}
		}
		hub.mu.Unlock()
	})

	unsubscribeTeam := func() {}
	if opts.Team != nil {
		unsubscribeTeam = opts.Team.OnMessage(func(msg string) {
			hub.mu.Lock()
			for _, ch := range hub.conns {
				select {
				case ch <- msg:
				default:
				}
			}
			hub.mu.Unlock()
		})
	}

	gin.SetMode(gin.ReleaseMode)
	engine := gin.New()
	engine.RedirectTrailingSlash = false
	engine.RedirectFixedPath = false
	_ = engine.SetTrustedProxies(nil)
	engine.Use(func(c *gin.Context) {
		defer func() {
			if p := recover(); p != nil {
				logf(fmt.Sprintf("erro HTTP: %v", p))
				if !c.Writer.Written() {
					send(c.Writer, 500, errBody(fmt.Sprint(p)), "")
				}
				c.Abort()
			}
		}()
		if !AllowedRequest(c.Request, opts.Host, port) {
			if c.Request.URL.Path == "/ws" && strings.EqualFold(c.Request.Header.Get("Upgrade"), "websocket") {
				c.Status(http.StatusForbidden)
				c.Abort()
				return
			}
			send(c.Writer, 403, errBody("Host/Origin não permitido"), "")
			c.Abort()
			return
		}
		c.Next()
	})

	if opts.Team != nil {
		opts.Team.Routes(engine)
	}

	clients := newClientNames(1024)
	engine.Any("/mcp", func(c *gin.Context) {
		ua := c.Request.Header.Get("User-Agent")
		if ua == "" {
			ua = "http"
		}
		actor := "agent:" + strings.SplitN(ua, "/", 2)[0]
		serveMCPHTTP(c.Writer, c.Request, NewMCP(store, actor, opts.Shot), clients)
	})
	engine.Any("/api/health", func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			send(c.Writer, 405, errBody("método não permitido"), "")
			return
		}
		send(c.Writer, 200, jsonv.NewObject("ok", true, "version", float64(store.Version()), "file", store.Path(), "storage", "sqlite", "docId", store.DocID()), "")
	})
	engine.Any("/api/document", func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			send(c.Writer, 405, errBody("método não permitido"), "")
			return
		}
		doc, version, _, _ := store.Snapshot()
		send(c.Writer, 200, jsonv.NewObject("doc", doc, "version", float64(version)), "")
	})
	engine.Any("/api/ops", func(c *gin.Context) {
		if c.Request.Method != http.MethodPost {
			send(c.Writer, 405, errBody("método não permitido"), "")
			return
		}
		body, present, err := readBody(c.Request)
		if err != nil {
			var he *httpError
			if errors.As(err, &he) {
				send(c.Writer, he.status, errBody(he.msg), "")
				return
			}
			send(c.Writer, 500, errBody(err.Error()), "")
			return
		}
		var parsed any
		if present {
			parsed, err = z.Parse(apiOpsBody, body)
		} else {
			_, _, err = z.ParseUndefined(apiOpsBody)
		}
		if err != nil {
			send(c.Writer, 400, errBody(err.Error()), "")
			return
		}
		b := parsed.(*jsonv.Object)
		actor := "api"
		if b.Has("actor") {
			actor = b.Str("actor")
		}
		res, err := store.Apply(b.Arr("ops"), actor, b.Str("label"))
		if err != nil {
			send(c.Writer, 422, errBody(err.Error()), "")
			return
		}
		send(c.Writer, 200, jsonv.NewObject("created", jsonv.FromGo(res.Created), "version", float64(store.Version())), "")
	})
	engine.Any("/api/export", func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			send(c.Writer, 405, errBody("método não permitido"), "")
			return
		}
		c.Writer.Header().Set("content-disposition", `attachment; filename="`+safeFileName(store.Doc().Str("name"))+`.paprika.json"`)
		send(c.Writer, 200, jsonv.Stringify(store.Doc(), "  ")+"\n", "application/json")
	})
	engine.Any("/api/workspaces", func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet:
			ws, err := store.ListWorkspaces()
			if err != nil {
				send(c.Writer, 500, errBody(err.Error()), "")
				return
			}
			send(c.Writer, 200, jsonv.NewObject("active", store.DocID(), "workspaces", jsonv.FromGo(ws)), "")
		case http.MethodPost:
			body, present, err := readBody(c.Request)
			if err != nil {
				var he *httpError
				if errors.As(err, &he) {
					send(c.Writer, he.status, errBody(he.msg), "")
					return
				}
				send(c.Writer, 500, errBody(err.Error()), "")
				return
			}
			if !present {
				body = jsonv.NewObject()
			}
			parsed, err := z.Parse(workspaceBody, body)
			if err != nil {
				send(c.Writer, 400, errBody(err.Error()), "")
				return
			}
			info, err := store.CreateWorkspace(parsed.(*jsonv.Object).Str("name"), "user")
			if err != nil {
				send(c.Writer, 500, errBody(err.Error()), "")
				return
			}
			send(c.Writer, 201, jsonv.NewObject("workspace", jsonv.FromGo(info)), "")
		default:
			send(c.Writer, 405, errBody("método não permitido"), "")
		}
	})
	engine.Any("/api/workspaces/:id", func(c *gin.Context) {
		id := c.Param("id")
		switch c.Request.Method {
		case http.MethodPatch:
			body, present, err := readBody(c.Request)
			if err != nil {
				var he *httpError
				if errors.As(err, &he) {
					send(c.Writer, he.status, errBody(he.msg), "")
					return
				}
				send(c.Writer, 500, errBody(err.Error()), "")
				return
			}
			if !present {
				body = jsonv.NewObject()
			}
			parsed, err := z.Parse(renameWorkspaceBody, body)
			if err != nil {
				send(c.Writer, 400, errBody(err.Error()), "")
				return
			}
			name := strings.TrimSpace(parsed.(*jsonv.Object).Str("name"))
			if name == "" {
				send(c.Writer, 400, errBody("o nome não pode ficar vazio"), "")
				return
			}
			info, err := store.RenameWorkspace(id, name, "user")
			if errors.Is(err, ErrNoWorkspace) {
				send(c.Writer, 404, errBody(`workspace "`+id+`" não existe`), "")
				return
			}
			if err != nil {
				send(c.Writer, 500, errBody(err.Error()), "")
				return
			}
			send(c.Writer, 200, jsonv.NewObject("workspace", jsonv.FromGo(info)), "")
		case http.MethodDelete:
			active, err := store.DeleteWorkspace(id, "user")
			switch {
			case errors.Is(err, ErrNoWorkspace):
				send(c.Writer, 404, errBody(`workspace "`+id+`" não existe`), "")
			case errors.Is(err, ErrLastWorkspace):
				send(c.Writer, 409, errBody("não é possível excluir o único workspace"), "")
			case err != nil:
				send(c.Writer, 500, errBody(err.Error()), "")
			default:
				send(c.Writer, 200, jsonv.NewObject("deleted", id, "active", active), "")
			}
		default:
			send(c.Writer, 405, errBody("método não permitido"), "")
		}
	})
	engine.Any("/api/workspaces/:id/cover", func(c *gin.Context) {
		id := c.Param("id")
		var info WorkspaceInfo
		var err error
		switch c.Request.Method {
		case http.MethodGet:
			data, mime, err := store.Cover(id)
			if errors.Is(err, ErrNoWorkspace) {
				send(c.Writer, 404, errBody(`workspace "`+id+`" não tem capa`), "")
				return
			}
			if err != nil {
				send(c.Writer, 500, errBody(err.Error()), "")
				return
			}
			h := c.Writer.Header()
			h.Set("content-type", mime)
			h.Set("cache-control", "private, max-age=31536000, immutable")
			h.Set("x-content-type-options", "nosniff")
			h.Set("content-security-policy", "default-src 'none'")
			c.Writer.WriteHeader(200)
			c.Writer.Write(data)
			return
		case http.MethodPut:
			data, rerr := io.ReadAll(io.LimitReader(c.Request.Body, MaxCoverBytes+1))
			if rerr != nil {
				send(c.Writer, 400, errBody(rerr.Error()), "")
				return
			}
			info, err = store.SetCover(id, data)
		case http.MethodDelete:
			info, err = store.ClearCover(id)
		default:
			send(c.Writer, 405, errBody("método não permitido"), "")
			return
		}
		switch {
		case errors.Is(err, ErrNoWorkspace):
			send(c.Writer, 404, errBody(`workspace "`+id+`" não existe`), "")
		case errors.Is(err, ErrBadCover):
			send(c.Writer, 415, errBody("a capa precisa ser uma imagem PNG, JPEG, WebP ou GIF de até 2 MiB"), "")
		case err != nil:
			send(c.Writer, 500, errBody(err.Error()), "")
		default:
			send(c.Writer, 200, jsonv.NewObject("workspace", jsonv.FromGo(info)), "")
		}
	})
	engine.Any("/api/workspaces/:id/open", func(c *gin.Context) {
		if c.Request.Method != http.MethodPost {
			send(c.Writer, 405, errBody("método não permitido"), "")
			return
		}
		id := c.Param("id")
		info, err := store.OpenWorkspace(id, "user")
		if errors.Is(err, ErrNoWorkspace) {
			send(c.Writer, 404, errBody(`workspace "`+id+`" não existe`), "")
			return
		}
		if err != nil {
			send(c.Writer, 500, errBody(err.Error()), "")
			return
		}
		send(c.Writer, 200, jsonv.NewObject("workspace", jsonv.FromGo(info), "version", float64(store.Version())), "")
	})
	engine.Any("/api/render", func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			send(c.Writer, 405, errBody("método não permitido"), "")
			return
		}
		html, _, err := core.RenderHTML(store.Doc(), core.RenderOptions{RootID: c.Query("root")})
		if err != nil {
			send(c.Writer, 500, errBody(err.Error()), "")
			return
		}
		send(c.Writer, 200, html, mimeTypes[".html"])
	})
	engine.Any("/api/screenshot", func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			send(c.Writer, 405, errBody("método não permitido"), "")
			return
		}
		if opts.Shot == nil {
			send(c.Writer, 500, errBody("screenshot indisponível neste servidor"), "")
			return
		}
		scale, _ := strconv.ParseFloat(c.Query("scale"), 64)
		if scale == 0 {
			scale = 1
		}
		png, _, _, err := opts.Shot.Screenshot(c.Request.Context(), store.Doc(), c.Query("root"), scale)
		if err != nil {
			logf("erro HTTP: " + err.Error())
			send(c.Writer, 500, errBody(err.Error()), "")
			return
		}
		send(c.Writer, 200, png, "image/png")
	})
	engine.Any("/api/svg", func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			send(c.Writer, 405, errBody("método não permitido"), "")
			return
		}
		if opts.Shot == nil {
			send(c.Writer, 500, errBody("export SVG indisponível neste servidor"), "")
			return
		}
		res, err := opts.Shot.ExportSVG(c.Request.Context(), store.Doc(), c.Query("root"))
		if err != nil {
			logf("erro HTTP: " + err.Error())
			send(c.Writer, 500, errBody(err.Error()), "")
			return
		}
		ws := make([]any, len(res.Warnings))
		for i, x := range res.Warnings {
			ws[i] = x
		}
		send(c.Writer, 200, jsonv.NewObject("svg", res.SVG, "width", res.Width, "height", res.Height, "warnings", ws), "")
	})
	engine.GET("/ws", func(c *gin.Context) {
		conn, err := websocket.Accept(c.Writer, c.Request, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		conn.SetReadLimit(maxBody)
		serveWS(c.Request.Context(), conn, store, hub, docMessage, opts.Team)
	})
	engine.NoRoute(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			send(c.Writer, 405, errBody("método não permitido"), "")
			return
		}
		serveStatic(c.Writer, c.Request, webRoot)
	})

	srv := &http.Server{Handler: engine}
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
			unsubscribePresence()
			unsubscribeTeam()
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
	docMessage func(*core.Document, int64, string, string, string, bool, bool) string, team TeamRoutes) {
	out := make(chan string, 64)
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	doc, version, cu, cr := store.Snapshot()
	out <- docMessage(doc, version, "server", "", "reload", cu, cr)
	for _, p := range store.Presence.Recent() {
		select {
		case out <- p.Message():
		default:
		}
	}
	if team != nil {
		for _, m := range team.Recent() {
			select {
			case out <- m:
			default:
			}
		}
	}
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

// clientNames remembers the clientInfo name of each HTTP session id. The MCP endpoint is
// stateless, so a tools/call carries no clientInfo: initialize hands out an Mcp-Session-Id and
// later calls are recorded under that client's name (bounded, oldest out; same as the former TS server).
type clientNames struct {
	mu    sync.Mutex
	max   int
	names map[string]string
	order []string
}

func newClientNames(max int) *clientNames { return &clientNames{max: max, names: map[string]string{}} }

func (c *clientNames) remember(name string) string {
	id := newSessionID()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.names[id] = name
	c.order = append(c.order, id)
	if len(c.order) > c.max {
		delete(c.names, c.order[0])
		c.order = c.order[1:]
	}
	return id
}

func (c *clientNames) get(id string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	n, ok := c.names[id]
	return n, ok
}

// newSessionID returns a random UUID v4 (like crypto.randomUUID in the former TS server).
func newSessionID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func serveMCPHTTP(w http.ResponseWriter, r *http.Request, m *MCP, clients *clientNames) {
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
	initName, hasInitName := "", false
	for _, msg := range batch {
		if o := msg.(*jsonv.Object); o.Str("method") == "initialize" {
			if v, ok := o.Obj("params").Obj("clientInfo").Get("name"); ok {
				initName, hasInitName = v.(string)
			}
			break
		}
	}
	if hasInitName {
		w.Header().Set("Mcp-Session-Id", clients.remember(initName))
	} else {
		m.SetSession(r.Header.Get("Mcp-Session-Id"))
		if name, ok := clients.get(r.Header.Get("Mcp-Session-Id")); ok {
			m.SetClient(name)
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
