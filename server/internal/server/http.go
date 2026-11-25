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
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/gin-gonic/gin"
	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/export"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
	z "github.com/leonardo-moraes360/paprika/server/internal/zod"
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
// Team status payloads (`GET /api/team`, `{type:"team",status}` on /ws) are opaque JSON from the
// sidecar and may include `app` / `format` (local and per peer); see docs/en-US/team-sync.md.
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
		return nil, false, &httpError{413, "body exceeds 8 MiB"}
	}
	if len(data) == 0 {
		return nil, false, nil
	}
	v, err := jsonv.Parse(data)
	if err != nil {
		return nil, false, &httpError{400, "invalid JSON"}
	}
	return v, true, nil
}

func readJSON(c *gin.Context) (any, bool, bool) {
	body, present, err := readBody(c.Request)
	if err == nil {
		return body, present, true
	}
	if he, ok := errors.AsType[*httpError](err); ok {
		send(c.Writer, he.status, errBody(he.msg), "")
		return nil, false, false
	}
	send(c.Writer, 500, errBody(err.Error()), "")
	return nil, false, false
}

func parseJSON(c *gin.Context, schema z.Schema) (*jsonv.Object, bool) {
	body, present, ok := readJSON(c)
	if !ok {
		return nil, false
	}
	if !present {
		body = jsonv.NewObject()
	}
	parsed, err := z.Parse(schema, body)
	if err != nil {
		send(c.Writer, 400, errBody(err.Error()), "")
		return nil, false
	}
	return parsed.(*jsonv.Object), true
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

func postWorkspace(c *gin.Context, store *Store, run func(id, actor string) (WorkspaceInfo, error)) {
	if c.Request.Method != http.MethodPost {
		send(c.Writer, 405, errBody("method not allowed"), "")
		return
	}
	id := c.Param("id")
	info, err := run(id, "user")
	if err == nil {
		send(c.Writer, 200, jsonv.NewObject("workspace", jsonv.FromGo(info), "active", store.DocID()), "")
		return
	}
	code, msg := 500, err.Error()
	if errors.Is(err, ErrNoWorkspace) {
		code, msg = 404, `workspace "`+id+`" does not exist`
	} else if errors.Is(err, ErrArchiveOnly) {
		code, msg = 409, "cannot archive the only workspace"
	}
	send(c.Writer, code, errBody(msg), "")
}

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
	// view: which workspace this canvas shows. Without workspaceId the canvas follows the active workspace.
	z.Option("view", z.Object(
		z.Field{Name: "type", Schema: z.Literal("view")},
		z.Field{Name: "workspaceId", Schema: z.Optional(z.String().Max(64))},
		z.Field{Name: "reqId", Schema: z.Optional(z.String())},
	)),
	z.Option("hello", z.Object(
		z.Field{Name: "type", Schema: z.Literal("hello")},
		z.Field{Name: "renderer", Schema: z.Enum("dom", "wasm")},
		z.Field{Name: "reqId", Schema: z.Optional(z.String())},
	)),
)

var apiOpsBody = z.Object(
	z.Field{Name: "ops", Schema: z.Array(core.OpSchema).Min(1)},
	z.Field{Name: "label", Schema: z.Optional(z.String())},
	z.Field{Name: "actor", Schema: z.Optional(z.String().Max(100))},
)

// POST /api/workspaces: name of the new workspace (blank: "Untitled").
var workspaceBody = z.Object(z.Field{Name: "name", Schema: z.Optional(z.String().Max(120))})
var folderBody = z.Object(z.Field{Name: "name", Schema: z.String().Min(1).Max(120)})
var moveFolderBody = z.Object(z.Field{Name: "folderId", Schema: z.Nullable(z.String().Max(64))})

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
	mu       sync.Mutex
	conns    map[*websocket.Conn]chan string
	order    []*websocket.Conn
	renderer map[*websocket.Conn]string
	// view is the workspace a connection was pointed at (a tab on /w/<id>); absent: it follows the active one.
	view map[*websocket.Conn]string
}

func (h *wsHub) rendererLine() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	parts := make([]string, 0, len(h.order))
	for _, c := range h.order {
		if mode := h.renderer[c]; mode != "" {
			parts = append(parts, mode)
		}
	}
	if len(parts) == 0 {
		return "none"
	}
	return strings.Join(parts, ", ")
}

type rendererSource struct {
	line func() string
}

var canvasRenderers atomic.Pointer[rendererSource]

func activeRendererLine() string {
	src := canvasRenderers.Load()
	if src == nil || src.line == nil {
		return "none"
	}
	return src.line()
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

	hub := &wsHub{conns: map[*websocket.Conn]chan string{}, renderer: map[*websocket.Conn]string{}, view: map[*websocket.Conn]string{}}
	renderers := &rendererSource{line: hub.rendererLine}
	canvasRenderers.Store(renderers)
	docMessage := func(doc *core.Document, version int64, actor, label, kind string, canUndo, canRedo bool) string {
		return jsonv.Stringify(jsonv.NewObject("type", "doc", "doc", doc, "version", float64(version), "actor", actor, "label", label,
			"kind", kind, "canUndo", canUndo, "canRedo", canRedo), "")
	}
	unsubscribe := store.OnChange(func(e ChangeEvent) {
		msg := docMessage(e.Doc, e.Version, e.Actor, e.Label, e.Kind, store.CanUndo(), store.CanRedo())
		hub.mu.Lock()
		for c, ch := range hub.conns {
			// A canvas pointed at another workspace keeps its own document.
			if v := hub.view[c]; v != "" && v != e.DocID {
				continue
			}
			select {
			case ch <- msg:
			default: // slow client: drop; it gets the full document on the next change
			}
		}
		hub.mu.Unlock()
	})
	unsubscribeAside := store.OnAside(func(e AsideEvent) {
		msg := docMessage(e.Doc, e.Version, e.Actor, e.Label, e.Kind, e.CanUndo, e.CanRedo)
		hub.mu.Lock()
		for c, ch := range hub.conns {
			if hub.view[c] != e.DocID {
				continue
			}
			select {
			case ch <- msg:
			default:
			}
		}
		hub.mu.Unlock()
	})

	stopOps := broadcastWorkspaceOps(store, hub)
	stopPins := broadcastPins(store, hub)

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
			send(c.Writer, 403, errBody("Host/Origin not allowed"), "")
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
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		send(c.Writer, 200, jsonv.NewObject("ok", true, "version", float64(store.Version()), "file", store.Path(), "storage", "sqlite", "docId", store.DocID()), "")
	})
	engine.Any("/api/document", func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		doc, version, _, _ := store.Snapshot()
		send(c.Writer, 200, jsonv.NewObject("doc", doc, "version", float64(version)), "")
	})
	engine.Any("/api/ops", func(c *gin.Context) {
		if c.Request.Method != http.MethodPost {
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		body, present, ok := readJSON(c)
		if !ok {
			return
		}
		var parsed any
		var err error
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
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		c.Writer.Header().Set("content-disposition", `attachment; filename="`+safeFileName(store.Doc().Str("name"))+`.paprika.json"`)
		send(c.Writer, 200, jsonv.Stringify(store.Doc(), "  ")+"\n", "application/json")
	})
	registerPinRoutes(engine, store)
	engine.Any("/api/workspaces", func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet:
			q := c.Request.URL.Query()
			include := q.Get("includeArchived") == "1" || q.Get("includeArchived") == "true"
			only := q.Get("archived") == "1" || q.Get("archived") == "true"
			ws, err := store.ListWorkspacesFiltered(include, only)
			if err != nil {
				send(c.Writer, 500, errBody(err.Error()), "")
				return
			}
			folders, err := store.ListFolders()
			if err != nil {
				send(c.Writer, 500, errBody(err.Error()), "")
				return
			}
			send(c.Writer, 200, jsonv.NewObject("active", store.DocID(), "workspaces", jsonv.FromGo(ws), "folders", jsonv.FromGo(folders)), "")
		case http.MethodPost:
			parsed, ok := parseJSON(c, workspaceBody)
			if !ok {
				return
			}
			info, err := store.CreateWorkspace(parsed.Str("name"), "user")
			if err != nil {
				send(c.Writer, 500, errBody(err.Error()), "")
				return
			}
			send(c.Writer, 201, jsonv.NewObject("workspace", jsonv.FromGo(info)), "")
		default:
			send(c.Writer, 405, errBody("method not allowed"), "")
		}
	})
	engine.Any("/api/workspaces/:id", func(c *gin.Context) {
		id := c.Param("id")
		switch c.Request.Method {
		case http.MethodPatch:
			parsed, ok := parseJSON(c, renameWorkspaceBody)
			if !ok {
				return
			}
			name := strings.TrimSpace(parsed.Str("name"))
			if name == "" {
				send(c.Writer, 400, errBody("name cannot be blank"), "")
				return
			}
			info, err := store.RenameWorkspace(id, name, "user")
			if errors.Is(err, ErrNoWorkspace) {
				send(c.Writer, 404, errBody(`workspace "`+id+`" does not exist`), "")
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
				send(c.Writer, 404, errBody(`workspace "`+id+`" does not exist`), "")
			case errors.Is(err, ErrLastWorkspace):
				send(c.Writer, 409, errBody("cannot delete the only workspace"), "")
			case err != nil:
				send(c.Writer, 500, errBody(err.Error()), "")
			default:
				send(c.Writer, 200, jsonv.NewObject("deleted", id, "active", active), "")
			}
		default:
			send(c.Writer, 405, errBody("method not allowed"), "")
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
				send(c.Writer, 404, errBody(`workspace "`+id+`" has no cover`), "")
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
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		switch {
		case errors.Is(err, ErrNoWorkspace):
			send(c.Writer, 404, errBody(`workspace "`+id+`" does not exist`), "")
		case errors.Is(err, ErrBadCover):
			send(c.Writer, 415, errBody("cover must be a PNG, JPEG, WebP or GIF image of at most 2 MiB"), "")
		case err != nil:
			send(c.Writer, 500, errBody(err.Error()), "")
		default:
			send(c.Writer, 200, jsonv.NewObject("workspace", jsonv.FromGo(info)), "")
		}
	})
	engine.Any("/api/workspaces/:id/folder", func(c *gin.Context) {
		if c.Request.Method != http.MethodPost {
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		id := c.Param("id")
		parsed, ok := parseJSON(c, moveFolderBody)
		if !ok {
			return
		}
		folderID := ""
		if v, ok := parsed.Get("folderId"); ok && v != nil {
			s, ok := v.(string)
			if !ok {
				send(c.Writer, 400, errBody("folderId must be a string or null"), "")
				return
			}
			folderID = s
		}
		info, err := store.MoveWorkspace(id, folderID, "user")
		switch {
		case errors.Is(err, ErrNoWorkspace):
			send(c.Writer, 404, errBody(`workspace "`+id+`" does not exist`), "")
		case errors.Is(err, ErrNoFolder):
			send(c.Writer, 404, errBody(`folder "`+strings.TrimSpace(folderID)+`" does not exist`), "")
		case err != nil:
			send(c.Writer, 500, errBody(err.Error()), "")
		default:
			send(c.Writer, 200, jsonv.NewObject("workspace", jsonv.FromGo(info)), "")
		}
	})
	engine.Any("/api/folders", func(c *gin.Context) {
		if c.Request.Method != http.MethodPost {
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		parsed, ok := parseJSON(c, folderBody)
		if !ok {
			return
		}
		folder, err := store.CreateFolder(parsed.Str("name"))
		if errors.Is(err, ErrBlankName) {
			send(c.Writer, 400, errBody(err.Error()), "")
			return
		}
		if err != nil {
			send(c.Writer, 500, errBody(err.Error()), "")
			return
		}
		send(c.Writer, 201, jsonv.NewObject("folder", jsonv.FromGo(folder)), "")
	})
	engine.Any("/api/folders/:id", func(c *gin.Context) {
		if c.Request.Method != http.MethodPatch {
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		id := c.Param("id")
		parsed, ok := parseJSON(c, folderBody)
		if !ok {
			return
		}
		folder, err := store.RenameFolder(id, parsed.Str("name"))
		switch {
		case errors.Is(err, ErrNoFolder):
			send(c.Writer, 404, errBody(`folder "`+id+`" does not exist`), "")
		case errors.Is(err, ErrBlankName):
			send(c.Writer, 400, errBody(err.Error()), "")
		case err != nil:
			send(c.Writer, 500, errBody(err.Error()), "")
		default:
			send(c.Writer, 200, jsonv.NewObject("folder", jsonv.FromGo(folder)), "")
		}
	})
	engine.Any("/api/workspaces/:id/archive", func(c *gin.Context) { postWorkspace(c, store, store.ArchiveWorkspace) })
	engine.Any("/api/workspaces/:id/unarchive", func(c *gin.Context) { postWorkspace(c, store, store.UnarchiveWorkspace) })
	engine.Any("/api/workspaces/:id/open", func(c *gin.Context) {
		if c.Request.Method != http.MethodPost {
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		id := c.Param("id")
		info, err := store.OpenWorkspace(id, "user")
		if errors.Is(err, ErrNoWorkspace) {
			send(c.Writer, 404, errBody(`workspace "`+id+`" does not exist`), "")
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
			send(c.Writer, 405, errBody("method not allowed"), "")
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
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		if opts.Shot == nil {
			send(c.Writer, 500, errBody("screenshot unavailable on this server"), "")
			return
		}
		scale, _ := strconv.ParseFloat(c.Query("scale"), 64)
		if scale == 0 {
			scale = 1
		}
		png, _, _, err := opts.Shot.ScreenshotMode(c.Request.Context(), store.Doc(), c.Query("root"), scale, c.Query("mode"))
		if err != nil {
			logf("erro HTTP: " + err.Error())
			send(c.Writer, 500, errBody(err.Error()), "")
			return
		}
		send(c.Writer, 200, png, "image/png")
	})
	engine.Any("/api/screenshot/:id", func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			send(c.Writer, 405, errBody("método não permitido"), "")
			return
		}
		arc, ok := opts.Shot.(shotArchive)
		if !ok {
			send(c.Writer, 404, errBody("screenshot não encontrado"), "")
			return
		}
		png, ok := arc.PNG(c.Param("id"))
		if !ok {
			send(c.Writer, 404, errBody("screenshot não encontrado"), "")
			return
		}
		c.Writer.Header().Set("content-security-policy", "default-src 'none'")
		send(c.Writer, 200, png, "image/png")
	})
	engine.Any("/api/svg", func(c *gin.Context) {
		if c.Request.Method != http.MethodGet {
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		res, err := core.ExportSVG(store.Doc(), c.Query("root"), nil)
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
	// The Inter faces embedded for export, served to the canvas so "Inter" looks the same in the
	// canvas, the screenshot and the export (the browser may not have it installed).
	engine.GET("/fonts/inter.css", func(c *gin.Context) {
		css, err := export.InterFontFaceCSS(func(file string) (string, error) { return "/fonts/" + file, nil })
		if err != nil {
			send(c.Writer, 500, errBody(err.Error()), "")
			return
		}
		send(c.Writer, 200, css, "text/css; charset=utf-8")
	})
	engine.GET("/fonts/:file", func(c *gin.Context) {
		raw, ok := export.InterFile(c.Param("file"))
		if !ok {
			send(c.Writer, 404, errBody("font not found"), "")
			return
		}
		send(c.Writer, 200, raw, "font/ttf")
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
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		serveStatic(c.Writer, c.Request, webRoot)
	})

	if msg := chromiumStartup(opts.Shot); msg != "" {
		logf(msg)
	}
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
			canvasRenderers.CompareAndSwap(renderers, nil)
			stopOps()
			stopPins()
			unsubscribe()
			unsubscribeAside()
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

// workspaceOpsPoll is how often the operations log is read for entries the canvases have not heard about.
const workspaceOpsPoll = 100 * time.Millisecond

// broadcastWorkspaceOps sends every new entry of the workspace operations log to the WebSocket clients as a
// workspaceOp message: the canvas shows who deleted, switched or renamed a workspace. Entries that existed
// when the server started are not replayed. The returned function stops it.
func broadcastWorkspaceOps(store *Store, hub *wsHub) func() {
	key := func(op WorkspaceOp) string {
		return fmt.Sprintf("%d|%s|%s|%s", op.At, op.Actor, op.Op, op.DocID)
	}
	seen := map[string]bool{}
	if entries, err := store.ListWorkspaceOps(MaxWorkspaceOps, ""); err == nil {
		for _, op := range entries {
			seen[key(op)] = true
		}
	}
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(workspaceOpsPoll)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
			}
			entries, err := store.ListWorkspaceOps(MaxWorkspaceOps, "")
			if err != nil {
				continue
			}
			current := make(map[string]bool, len(entries))
			for _, op := range slices.Backward(entries) {

				k := key(op)
				current[k] = true
				if seen[k] {
					continue
				}
				msg := jsonv.Stringify(jsonv.NewObject("type", "workspaceOp", "op", jsonv.FromGo(op)), "")
				hub.mu.Lock()
				for _, ch := range hub.conns {
					select {
					case ch <- msg:
					default:
					}
				}
				hub.mu.Unlock()
			}
			seen = current
		}
	}()
	var once sync.Once
	return func() { once.Do(func() { close(stop) }) }
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
		send(w, 200, `<!doctype html><meta charset="utf-8"><title>Paprika</title><p>Canvas not built. Run <code>pnpm build</code>. MCP is at <code>/mcp</code>.</p>`, mimeTypes[".html"])
		return
	}
	rel, err := url.PathUnescape(r.URL.EscapedPath())
	if err != nil {
		send(w, 403, errBody("forbidden path"), "")
		return
	}
	rel = strings.TrimLeft(path.Clean("/"+rel), "/")
	file := filepath.Join(webRoot, filepath.FromSlash(rel))
	if file != webRoot && !strings.HasPrefix(file, webRoot+string(filepath.Separator)) {
		send(w, 403, errBody("forbidden path"), "")
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
	hub.order = append(hub.order, conn)
	hub.mu.Unlock()
	defer func() {
		hub.mu.Lock()
		delete(hub.conns, conn)
		delete(hub.renderer, conn)
		delete(hub.view, conn)
		hub.order = slices.DeleteFunc(hub.order, func(c *websocket.Conn) bool { return c == conn })
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
		case "hello":
			mode := msg.Str("renderer")
			hub.mu.Lock()
			if _, ok := hub.conns[conn]; ok {
				hub.renderer[conn] = mode
			}
			hub.mu.Unlock()
			hello := jsonv.NewObject("type", "hello", "renderer", mode)
			if hasReq {
				hello.Set("reqId", reqID)
			}
			reply(hello)
			continue
		case "view":
			id := msg.Str("workspaceId")
			var head WorkspaceHead
			if id != "" {
				if head, err = store.ReadWorkspace(id); err != nil {
					if errors.Is(err, ErrNoWorkspace) {
						err = store.WorkspaceChoiceError(id)
					}
					fail(err.Error())
					continue
				}
			}
			// Register before reading the document so a commit in between reaches this canvas.
			hub.mu.Lock()
			if _, ok := hub.conns[conn]; ok {
				if id == "" {
					delete(hub.view, conn)
				} else {
					hub.view[conn] = id
				}
			}
			hub.mu.Unlock()
			var d *core.Document
			var cu, cr bool
			if id == "" {
				d, head.Version, cu, cr = store.Snapshot()
			} else if head, err = store.ReadWorkspace(id); err != nil {
				fail(err.Error())
				continue
			} else {
				d, cu, cr = head.Doc, head.CanUndo, head.CanRedo
			}
			select {
			case out <- docMessage(d, head.Version, "server", "", "reload", cu, cr):
			case <-ctx.Done():
			}
			if hasReq {
				reply(jsonv.NewObject("type", "ack", "reqId", reqID, "version", float64(head.Version)))
			}
			continue
		case "ops", "undo", "redo":
			hub.mu.Lock()
			view := hub.view[conn]
			hub.mu.Unlock()
			var version int64
			switch {
			case view == "" && msg.Str("type") == "ops":
				_, err = store.Apply(msg.Arr("ops"), "user", msg.Str("label"))
				version = store.Version()
			case view == "" && msg.Str("type") == "undo":
				_, err = store.Undo("user")
				version = store.Version()
			case view == "":
				_, err = store.Redo("user")
				version = store.Version()
			case msg.Str("type") == "ops":
				var head WorkspaceHead
				_, head, err = store.ApplyIn(view, msg.Arr("ops"), "user", msg.Str("label"), "")
				version = head.Version
			default:
				var head WorkspaceHead
				_, head, err = store.StepIn(view, "user", msg.Str("type") == "redo")
				version = head.Version
			}
			if err != nil {
				fail(err.Error())
				continue
			}
			if hasReq {
				reply(jsonv.NewObject("type", "ack", "reqId", reqID, "version", float64(version)))
			}
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
