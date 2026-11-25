package server

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"unicode"

	"github.com/leonardo-moraes360/paprika/server-go/contract"
	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/export"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	z "github.com/leonardo-moraes360/paprika/server-go/internal/zod"
)

// Version of the server (kept equal to the TypeScript reference).
const Version = "0.1.0"

// Protocol versions accepted by initialize (same list as the TypeScript SDK).
var supportedProtocolVersions = []string{"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"}

const latestProtocolVersion = "2025-11-25"

// Contract is the parsed MCP contract (tool definitions are served verbatim).
type Contract struct {
	ServerInfo   *jsonv.Object
	Capabilities *jsonv.Object
	Instructions string
	Tools        []any
}

var mcpContract = func() Contract {
	v, err := jsonv.Parse(contract.MCP)
	if err != nil {
		panic(err)
	}
	o := v.(*jsonv.Object)
	return Contract{o.Obj("serverInfo"), o.Obj("capabilities"), o.Str("instructions"), o.Arr("tools")}
}()

// DesignGuide is the agent-facing guide (also sent as MCP instructions).
var DesignGuide = mcpContract.Instructions

// ToolResult is an MCP CallToolResult.
type ToolResult = *jsonv.Object

func textResult(s string) ToolResult {
	return jsonv.NewObject("content", []any{jsonv.NewObject("type", "text", "text", s)})
}

// jsonResult answers v as JSON text and, for an object, as structuredContent too (outputSchema).
func jsonResult(v any) ToolResult {
	j := jsonv.FromGo(v)
	res := textResult(jsonv.Stringify(j, "  "))
	if o, ok := j.(*jsonv.Object); ok {
		res.Set("structuredContent", o)
	}
	return res
}

// jsonShown answers `shown` as text (an array, kept for older clients) and `structured` as structuredContent.
func jsonShown(structured *jsonv.Object, shown any) ToolResult {
	res := textResult(jsonv.Stringify(jsonv.FromGo(shown), "  "))
	res.Set("structuredContent", structured)
	return res
}

func nodeDim(n *jsonv.Object, key string) any {
	v, ok := n.Get(key)
	if !ok || v == nil {
		return 0.0
	}
	switch v.(type) {
	case float64, string:
		return v
	default:
		return 0.0
	}
}

func createdShape(doc *core.Document, ids []string) (idList []any, roots []any, created []any, lines []string) {
	set := make(map[string]bool, len(ids))
	for _, id := range ids {
		set[id] = true
	}
	idList = make([]any, 0, len(ids))
	created = make([]any, 0, len(ids))
	roots = []any{}
	for _, id := range ids {
		idList = append(idList, id)
		n := core.GetNode(doc, id)
		if n == nil {
			continue
		}
		var parent any
		if v, ok := n.Get("parentId"); ok {
			parent = v
		}
		created = append(created, jsonv.NewObject("id", n.Str("id"), "name", n.Str("name"), "type", n.Str("type"), "parentId", parent))
		if pid, _ := parent.(string); pid != "" && set[pid] {
			continue
		}
		roots = append(roots, jsonv.NewObject(
			"id", n.Str("id"), "name", n.Str("name"), "type", n.Str("type"),
			"x", n.Num("x"), "y", n.Num("y"), "width", nodeDim(n, "width"), "height", nodeDim(n, "height"),
		))
		lines = append(lines, core.DescribeNode(n))
	}
	return idList, roots, created, lines
}

func enrichCreated(out *jsonv.Object, doc *core.Document, ids []string) (*jsonv.Object, []string) {
	idList, roots, created, lines := createdShape(doc, ids)
	next := jsonv.NewObject()
	placed := false
	for _, k := range out.Keys() {
		if k == "created" {
			next.Set("ids", idList)
			next.Set("roots", roots)
			next.Set("created", created)
			placed = true
			continue
		}
		v, _ := out.Get(k)
		next.Set(k, v)
	}
	if !placed {
		next.Set("ids", idList)
		next.Set("roots", roots)
		next.Set("created", created)
	}
	return next, lines
}

func resultWithRoots(out *jsonv.Object, doc *core.Document, ids []string) ToolResult {
	shaped, lines := enrichCreated(out, doc, ids)
	res := jsonResult(shaped)
	if len(lines) > 0 {
		res.Set("content", append(res.Arr("content"), jsonv.NewObject("type", "text", "text", strings.Join(lines, "\n"))))
	}
	return res
}

func pageByName(doc *core.Document, name string) string {
	match := func(id string) string {
		n := core.GetNode(doc, id)
		if n != nil && n.Str("type") == "page" && n.Str("name") == name {
			return id
		}
		return ""
	}
	for _, id := range doc.Strings("rootIds") {
		if found := match(id); found != "" {
			return found
		}
	}
	for _, id := range core.Nodes(doc).Keys() {
		if found := match(id); found != "" {
			return found
		}
	}
	return ""
}

func errorResult(msg string) ToolResult {
	return jsonv.NewObject("content", []any{jsonv.NewObject("type", "text", "text", msg)}, "isError", true)
}

// mcpError mirrors the SDK's McpError message ("MCP error <code>: <message>").
type mcpError struct {
	code int
	msg  string
}

func (e *mcpError) Error() string { return fmt.Sprintf("MCP error %d: %s", e.code, e.msg) }

const (
	codeParseError     = -32700
	codeInvalidRequest = -32600
	codeMethodNotFound = -32601
	codeInvalidParams  = -32602
	codeInternal       = -32603
)

type tool struct {
	name    string
	schema  *z.ObjectSchema // nil: the tool takes no arguments (they are not validated)
	handler func(ctx context.Context, args *jsonv.Object) (ToolResult, error)
}

// MCP serves the Paprika tools over one Store. One instance per connection (cheap).
type MCP struct {
	store *Store
	actor string // fallback actor (User-Agent, "stdio") when the client sent no clientInfo name
	// client: clientInfo.name from initialize on this connection (stdio), or remembered for the
	// HTTP session id. It names the actor ("agent:<name>").
	client string
	// session: Mcp-Session-Id of the HTTP request; it tells apart agents with the same name (presence).
	session string
	tools   map[string]tool
	shot    Screenshotter
}

// Screenshotter renders HTML in a browser for PNG screenshots.
type Screenshotter interface {
	ScreenshotMode(ctx context.Context, doc *core.Document, rootID string, scale float64, mode string) (png []byte, width, height int, err error)
}

// HTMLComputer renders HTML in Chromium and returns it with author styles inlined.
type HTMLComputer interface {
	ComputedHTML(ctx context.Context, html string) (string, error)
}

func optStr(name string) z.Field { return z.Field{Name: name, Schema: z.Optional(z.String())} }

func propNameArg() z.Schema {
	return z.String().Regex(`^[A-Za-z][A-Za-z0-9_]{0,31}$`, `/^[A-Za-z][A-Za-z0-9_]{0,31}$/`, "prop name must be [A-Za-z][A-Za-z0-9_]{0,31}")
}

func componentPropArg() z.Schema {
	return z.Object(
		z.Field{Name: "name", Schema: propNameArg()},
		z.Field{Name: "type", Schema: z.Enum("text", "boolean", "variant")},
		z.Field{Name: "default", Schema: z.Optional(z.Union(z.String().Max(2000), z.Bool()))},
		z.Field{Name: "options", Schema: z.Optional(z.Array(z.String().Regex(`^[A-Za-z0-9_-]{1,40}$`, `/^[A-Za-z0-9_-]{1,40}$/`, "variant option must be [A-Za-z0-9_-]{1,40}")).Min(1).Max(24))},
	)
}

func workspaceID() z.Field {
	return z.Field{Name: "workspaceId", Schema: z.Optional(z.String().Min(1))}
}

func label() z.Field { return z.Field{Name: "label", Schema: z.Optional(z.String().Max(200))} }

func batch() z.Field { return z.Field{Name: "batch", Schema: z.Optional(z.String().Min(1).Max(200))} }

// ActorFromClient turns a clientInfo name into "agent:<name>" (same filter as the former TS server); "" if nothing is left.
func ActorFromClient(name string) string {
	var b strings.Builder
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || strings.ContainsRune(" ._@:/+-", r) {
			b.WriteRune(r)
		}
	}
	clean := strings.TrimSpace(b.String())
	if rs := []rune(clean); len(rs) > 64 {
		clean = string(rs[:64])
	}
	if clean == "" {
		return ""
	}
	return "agent:" + clean
}

// SetClient records the client's name (from an earlier initialize) for the actor.
func (m *MCP) SetClient(name string) { m.client = name }

// SetSession records the HTTP session id, so presence tells apart two agents with the same name.
func (m *MCP) SetSession(id string) { m.session = id }

func (m *MCP) actorName() string {
	if a := ActorFromClient(m.client); a != "" {
		return a
	}
	return m.actor
}

// NewMCP builds the tool set for an actor ("agent:claude", "agent:stdio"…).
func NewMCP(store *Store, actor string, shot Screenshotter) *MCP {
	if actor == "" {
		actor = "agent"
	}
	m := &MCP{store: store, actor: actor, tools: map[string]tool{}, shot: shot}
	add := func(name string, schema *z.ObjectSchema, h func(ctx context.Context, args *jsonv.Object) (ToolResult, error)) {
		m.tools[name] = tool{name, schema, h}
	}
	wsErr := func(id string, err error) error {
		if errors.Is(err, ErrNoWorkspace) {
			return store.WorkspaceChoiceError(id)
		}
		return err
	}
	docOf := func(a *jsonv.Object) (*core.Document, error) {
		head, err := store.ReadWorkspace(a.Str("workspaceId"))
		if err != nil {
			return nil, wsErr(a.Str("workspaceId"), err)
		}
		return head.Doc, nil
	}
	stamp := func(out *jsonv.Object, head WorkspaceHead) {
		out.Set("workspaceId", head.ID)
		out.Set("workspaceName", head.Name)
	}
	applyHere := func(a *jsonv.Object, ops []any, lbl string) (*core.ApplyResult, WorkspaceHead, error) {
		r, head, err := store.ApplyIn(a.Str("workspaceId"), ops, m.actorName(), lbl, a.Str("batch"))
		if err != nil {
			return nil, WorkspaceHead{}, wsErr(a.Str("workspaceId"), err)
		}
		return r, head, nil
	}
	writeBatch := func(a *jsonv.Object, ops []any, lbl, bt string, extra ...any) (ToolResult, error) {
		r, head, err := store.ApplyIn(a.Str("workspaceId"), ops, m.actorName(), lbl, bt)
		if err != nil {
			return nil, wsErr(a.Str("workspaceId"), err)
		}
		out := jsonv.NewObject(extra...)
		out.Set("created", jsonv.FromGo(r.Created))
		out.Set("version", float64(head.Version))
		stamp(out, head)
		return jsonResult(out), nil
	}
	writeWith := func(a *jsonv.Object, ops []any, lbl string, extra ...any) (ToolResult, error) {
		return writeBatch(a, ops, lbl, a.Str("batch"), extra...)
	}
	write := func(a *jsonv.Object, ops []any, lbl string) (ToolResult, error) { return writeWith(a, ops, lbl) }
	shapedWrite := func(a *jsonv.Object, ops []any, lbl string, extra ...any) (ToolResult, *core.Document, error) {
		r, head, err := applyHere(a, ops, lbl)
		if err != nil {
			return nil, nil, err
		}
		out := jsonv.NewObject(extra...)
		out.Set("created", []any{})
		out.Set("version", float64(head.Version))
		stamp(out, head)
		return resultWithRoots(out, head.Doc, r.Created), head.Doc, nil
	}
	labelOr := func(args *jsonv.Object, def string) string {
		if args.Has("label") {
			return args.Str("label")
		}
		return def
	}
	count := func(n int) string { return jsonv.FormatNumber(float64(n)) }

	add("get_design_guide", z.Object(z.Field{Name: "language", Schema: z.Default(z.Enum("en", "pt-BR"), "en")}),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			if a.Str("language") == "pt-BR" {
				return textResult(contract.GuidePtBR), nil
			}
			return textResult(DesignGuide), nil
		})

	add("get_document_outline", z.Object(
		optStr("rootId"),
		z.Field{Name: "depth", Schema: z.Optional(z.Int().Min(0).Max(50))},
		workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		head, err := store.ReadWorkspace(a.Str("workspaceId"))
		if err != nil {
			return nil, wsErr(a.Str("workspaceId"), err)
		}
		d, version := head.Doc, head.Version
		rootID := a.Str("rootId")
		if rootID != "" && core.GetNode(d, rootID) == nil {
			return nil, fmt.Errorf(`node "%s" does not exist`, rootID)
		}
		depth := -1
		if a.Has("depth") {
			depth = int(a.Num("depth"))
		}
		var toks []string
		for _, k := range core.Tokens(d).Keys() {
			v, _ := core.Tokens(d).Get(k)
			line := "$" + k + "=" + jsString(v)
			if meta := core.TokenMeta(d); meta != nil {
				if m := meta.Obj(k); m != nil {
					if t := m.Str("type"); t != "" {
						line += " " + t
					}
					if c := m.Str("collection"); c != "" {
						line += " @" + c
					}
				}
			}
			toks = append(toks, line)
		}
		tokens := strings.Join(toks, " ")
		if tokens == "" {
			tokens = "(none)"
		}
		modes := ""
		if ms := core.Modes(d); ms != nil && ms.Len() > 0 {
			var parts []string
			for _, m := range ms.Keys() {
				var kv []string
				for _, k := range ms.Obj(m).Keys() {
					v, _ := ms.Obj(m).Get(k)
					kv = append(kv, "$"+k+"="+jsString(v))
				}
				parts = append(parts, m+"("+strings.Join(kv, " ")+")")
			}
			modes = "modes: " + strings.Join(parts, " ") + "\n"
		}
		return textResult(fmt.Sprintf("workspace %s \"%s\" v%d · %s nodes\ntokens: %s\nrenderer: %s\n%s\n%s", head.ID, d.Str("name"), version,
			count(core.Nodes(d).Len()), tokens, activeRendererLine(), modes, core.Outline(d, rootID, depth))), nil
	})

	add("get_nodes", z.Object(z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(200)}, workspaceID()),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			d, err := docOf(a)
			if err != nil {
				return nil, err
			}
			ids := a.Strings("ids")
			missing := []any{}
			out := make([]any, 0, len(ids))
			for _, id := range ids {
				n := core.GetNode(d, id)
				if n == nil {
					missing = append(missing, id)
					continue
				}
				out = append(out, n)
			}
			if len(out) == 0 {
				return nil, fmt.Errorf("nodes do not exist: %s", strings.Join(a.Strings("ids"), ", "))
			}
			structured := jsonv.NewObject("nodes", out)
			if len(missing) > 0 {
				// The nodes that exist still come back (an undo may have removed some of them).
				structured.Set("missing", missing)
				return jsonShown(structured, jsonv.NewObject("nodes", out, "missing", missing)), nil
			}
			return jsonShown(structured, out), nil
		})

	add("find_nodes", z.Object(
		z.Field{Name: "type", Schema: z.Optional(core.NodeTypeSchema)},
		optStr("name"), optStr("text"), optStr("within"),
		z.Field{Name: "limit", Schema: z.Default(z.Int().Min(1).Max(500), 50.0)},
		workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		d, err := docOf(a)
		if err != nil {
			return nil, err
		}
		found := core.QueryNodes(d, core.NodeQuery{Type: a.Str("type"), Name: a.Str("name"), Text: a.Str("text"), Within: a.Str("within"), Limit: int(a.Num("limit"))})
		lines := make([]string, len(found))
		for i, n := range found {
			lines[i] = core.DescribeNode(n)
		}
		if len(lines) == 0 {
			return textResult("(nothing found)"), nil
		}
		return textResult(strings.Join(lines, "\n")), nil
	})

	add("get_bounds", z.Object(
		z.Field{Name: "ids", Schema: z.Optional(z.Array(z.String()).Min(1).Max(500))},
		optStr("rootId"),
		workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		d, err := docOf(a)
		if err != nil {
			return nil, err
		}
		opts := core.LayoutOptions{RootID: a.Str("rootId")}
		if a.Has("ids") {
			opts.IDs = a.Strings("ids")
		}
		boxes, err := core.Layout(d, opts)
		if err != nil {
			return nil, err
		}
		if a.Has("ids") {
			missing := []string{}
			for _, id := range opts.IDs {
				if _, ok := boxes[id]; !ok {
					if core.GetNode(d, id) == nil {
						missing = append(missing, id)
					}
				}
			}
			if len(missing) > 0 {
				return nil, fmt.Errorf("nodes do not exist: %s", strings.Join(missing, ", "))
			}
		}
		out := jsonv.NewObject()
		boxesObj := jsonv.NewObject()
		for id, b := range boxes {
			boxesObj.Set(id, core.LayoutBoxJSON(b))
		}
		out.Set("boxes", boxesObj)
		// An id that exists but has no box is named, never dropped: a page has no geometry, and a node hidden
		// inside an auto-layout frame is not laid out.
		if a.Has("ids") {
			var unplaced []any
			seen := map[string]bool{}
			for _, id := range a.Strings("ids") {
				if _, ok := boxes[id]; ok || seen[id] {
					continue
				}
				seen[id] = true
				reason := "not laid out (hidden inside an auto-layout frame, or outside rootId)"
				if n := core.GetNode(d, id); n != nil && n.Str("type") == "page" {
					reason = "a page has no box; its frames sit in canvas coordinates"
				}
				unplaced = append(unplaced, jsonv.NewObject("id", id, "reason", reason))
			}
			if len(unplaced) > 0 {
				out.Set("unplaced", unplaced)
			}
		}
		if !a.Has("ids") {
			sum := core.SummarizePlacement(d, a.Str("rootId"))
			content := jsonv.NewObject()
			if sum.PageID != "" {
				content.Set("page", sum.PageID)
			}
			content.Set("x", sum.Content.X)
			content.Set("y", sum.Content.Y)
			content.Set("width", sum.Content.W)
			content.Set("height", sum.Content.H)
			out.Set("content", content)
			out.Set("next", jsonv.NewObject("x", sum.NextX, "y", sum.NextY))
		}
		return jsonResult(out), nil
	})

	add("path_info", z.Object(
		z.Field{Name: "d", Schema: z.Optional(z.String().Max(200_000))},
		optStr("id"),
		workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		src := a.Str("d")
		ox, oy := 0.0, 0.0
		id := a.Str("id")
		var nodeW, nodeH, nodeRot float64
		var doc *core.Document
		if id != "" {
			var err error
			doc, err = docOf(a)
			if err != nil {
				return nil, err
			}
			n := core.GetNode(doc, id)
			if n == nil {
				return nil, fmt.Errorf(`node "%s" does not exist`, id)
			}
			if t := n.Str("type"); t != "path" {
				return nil, fmt.Errorf(`node "%s" is %s, not a path`, id, t)
			}
			src, ox, oy = n.Str("d"), n.Num("x"), n.Num("y")
			nodeW, nodeH, nodeRot = n.Num("width"), n.Num("height"), n.Num("rotation")
		}
		if src == "" {
			return nil, errors.New("pass d or id")
		}
		segs, err := core.ParsePath(src)
		if err != nil {
			return nil, err
		}
		b := core.PathBounds(segs)
		originLocal := core.PathOrigin(segs)
		curves, closed := 0, false
		for _, s := range segs {
			switch s.Cmd {
			case 'C', 'Q', 'A':
				curves++
			case 'Z':
				closed = true
			}
		}
		r := func(v float64) float64 { return jsonv.Round(v*100) / 100 }
		out := jsonv.NewObject(
			"segments", float64(len(segs)),
			"curves", float64(curves),
			"closed", closed,
			"bounds", jsonv.NewObject("x", r(b.X), "y", r(b.Y), "width", r(b.Width), "height", r(b.Height)),
			"origin", jsonv.NewObject("x", r(originLocal.X), "y", r(originLocal.Y)),
		)
		if id != "" {
			out.Set("canvasBounds", jsonv.NewObject("x", r(ox+b.X), "y", r(oy+b.Y), "width", r(b.Width), "height", r(b.Height)))
			boxes, _ := core.Layout(doc, core.LayoutOptions{IDs: []string{id}})
			if lb, ok := boxes[id]; ok {
				out.Set("transformOrigin", jsonv.NewObject("x", r(lb.Origin.X), "y", r(lb.Origin.Y)))
				out.Set("corners", core.LayoutBoxJSON(lb).Arr("corners"))
			} else {
				cx, cy := ox+nodeW/2, oy+nodeH/2
				out.Set("transformOrigin", jsonv.NewObject("x", r(cx), "y", r(cy)))
				_ = nodeRot
			}
		}
		out.Set("normalized", core.SerializePath(segs))
		out.Set("anchors", pathAnchors(segs))
		return jsonResult(out), nil
	})

	pointArg := z.Object(
		z.Field{Name: "x", Schema: z.Number()},
		z.Field{Name: "y", Schema: z.Number()},
	)
	add("edit_path", z.Object(
		z.Field{Name: "id", Schema: z.String()},
		z.Field{Name: "index", Schema: z.Int().Min(0)},
		z.Field{Name: "position", Schema: z.Optional(pointArg)},
		z.Field{Name: "handles", Schema: z.Optional(z.Object(
			z.Field{Name: "in", Schema: z.Optional(pointArg)},
			z.Field{Name: "out", Schema: z.Optional(pointArg)},
			z.Field{Name: "mirror", Schema: z.Optional(z.Bool())},
		))},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		id := a.Str("id")
		doc, err := docOf(a)
		if err != nil {
			return nil, err
		}
		n := core.GetNode(doc, id)
		if n == nil {
			return nil, fmt.Errorf(`node "%s" does not exist`, id)
		}
		if t := n.Str("type"); t != "path" {
			return nil, fmt.Errorf(`node "%s" is %s, not a path`, id, t)
		}
		if n.Bool("locked") {
			return nil, fmt.Errorf(`node "%s" is locked; unlock it before editing its points`, id)
		}
		if owner := core.CopyOwner(doc, n); owner != nil {
			return nil, fmt.Errorf(`%q is a copy inside the instance %q; edit the component or detach it`, id, owner.Str("id"))
		}
		if !a.Has("position") && !a.Has("handles") {
			return nil, errors.New("pass position or handles")
		}
		var handleIn, handleOut *jsonv.Object
		mirror := false
		if a.Has("handles") {
			h := a.Obj("handles")
			if h.Has("in") {
				handleIn = h.Obj("in")
			}
			if h.Has("out") {
				handleOut = h.Obj("out")
			}
			if handleIn == nil && handleOut == nil {
				return nil, errors.New("handles needs in or out")
			}
			mirror = h.Bool("mirror")
		}
		segs, err := core.ParsePath(n.Str("d"))
		if err != nil {
			return nil, fmt.Errorf("invalid d: %s", err.Error())
		}
		subs := core.PathToSubpaths(segs)
		ref, ok := core.AnchorByFlatIndex(subs, int(a.Num("index")))
		if !ok {
			nAnchors := 0
			for _, s := range subs {
				nAnchors += len(s.Anchors)
			}
			return nil, fmt.Errorf(`path "%s" has %d anchors; index %d is out of range (see path_info.anchors)`, id, nAnchors, int(a.Num("index")))
		}
		if a.Has("position") {
			p := a.Obj("position")
			subs = core.MoveAnchor(subs, ref, core.Point{X: p.Num("x"), Y: p.Num("y")})
		}
		if handleIn != nil {
			subs = core.MoveHandle(subs, ref, "in", core.Point{X: handleIn.Num("x"), Y: handleIn.Num("y")}, mirror && handleOut == nil)
		}
		if handleOut != nil {
			subs = core.MoveHandle(subs, ref, "out", core.Point{X: handleOut.Num("x"), Y: handleOut.Num("y")}, mirror && handleIn == nil)
		}
		edited := core.PathEditProps(core.PathEditNode{X: n.Num("x"), Y: n.Num("y"), ViewBox: n.Has("viewBox")}, subs, pathMoveBox(doc, n))
		if edited == nil {
			return nil, fmt.Errorf(`path "%s" has no points to edit`, id)
		}
		props := jsonv.NewObject("d", edited.D)
		if edited.HasXY {
			props.Set("x", edited.X)
			props.Set("y", edited.Y)
		}
		if edited.HasSize {
			props.Set("width", edited.Width)
			props.Set("height", edited.Height)
		}
		next, err := core.ParsePath(edited.D)
		if err != nil {
			return nil, fmt.Errorf("invalid d: %s", err.Error())
		}
		def := "move handle"
		if a.Has("position") {
			def = "move point"
		}
		op := jsonv.NewObject("op", "update", "id", id, "props", props)
		return writeWith(a, []any{op}, labelOr(a, def), "props", props, "anchors", pathAnchors(next))
	})

	placeSchema := z.Optional(z.Union(
		z.Enum("free", "below", "right", "none"),
		z.Object(
			z.Field{Name: "near", Schema: z.String().Min(1).Max(64)},
			z.Field{Name: "side", Schema: z.Enum("left", "right", "above", "below")},
		),
	))
	add("create_nodes", z.Object(
		z.Field{Name: "parentId", Schema: z.Optional(z.Nullable(z.String()))},
		z.Field{Name: "index", Schema: z.Optional(z.Int().Min(0))},
		z.Field{Name: "nodes", Schema: z.Array(core.NodeInputSchema).Min(1).Max(500)},
		z.Field{Name: "place", Schema: placeSchema},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		doc, err := docOf(a)
		if err != nil {
			return nil, err
		}
		nodes := a.Arr("nodes")
		warnings := stripConnectorDerived(nodes)
		parentID, _ := a.Get("parentId")
		ops := make([]any, len(nodes))
		for i, n := range nodes {
			op := jsonv.NewObject("op", "create", "node", n, "parentId", parentID)
			if a.Has("index") {
				op.Set("index", a.Num("index")+float64(i))
			}
			if o, ok := n.(*jsonv.Object); ok {
				if p, use := createPlace(doc, parentID, o, a); use {
					op.Set("place", p)
				} else if a.Has("place") && a.Str("place") == "none" {
					if w := pinAbsolute(doc, parentID, o); w != "" {
						warnings = append(warnings, w)
					}
				}
			}
			ops[i] = op
		}
		r, wrote, err := shapedWrite(a, ops, labelOr(a, "create "+count(len(nodes))+" node(s)"))
		if err != nil {
			return nil, err
		}
		if len(warnings) > 0 {
			content := r.Arr("content")
			r.Set("content", append(content, jsonv.NewObject("type", "text", "text", "warnings: "+strings.Join(warnings, "; "))))
		}
		appendOverlap(r, wrote)
		return r, nil
	})

	add("update_nodes", z.Object(
		z.Field{Name: "updates", Schema: z.Array(z.Object(
			z.Field{Name: "id", Schema: z.String()},
			z.Field{Name: "props", Schema: z.Record(z.String(), z.Unknown())},
		)).Min(1).Max(500)},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		ups := a.Arr("updates")
		ops := make([]any, len(ups))
		for i, u := range ups {
			uo := u.(*jsonv.Object)
			props, _ := uo.Get("props")
			ops[i] = jsonv.NewObject("op", "update", "id", uo.Str("id"), "props", props)
		}
		return write(a, ops, labelOr(a, "update "+count(len(ups))+" node(s)"))
	})

	add("delete_nodes", z.Object(z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)}, label(), batch(), workspaceID()),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			ids := a.Strings("ids")
			ops := make([]any, len(ids))
			for i, id := range ids {
				ops[i] = jsonv.NewObject("op", "delete", "id", id)
			}
			r, head, err := applyHere(a, ops, labelOr(a, "delete "+count(len(ids))+" node(s)"))
			if err != nil {
				return nil, err
			}
			deleted := r.Removed
			if deleted == nil {
				deleted = []string{}
			}
			out := jsonv.NewObject("deleted", jsonv.FromGo(deleted), "version", float64(head.Version))
			stamp(out, head)
			return jsonResult(out), nil
		})

	add("move_nodes", z.Object(
		z.Field{Name: "moves", Schema: z.Array(z.Object(
			z.Field{Name: "id", Schema: z.String()},
			z.Field{Name: "parentId", Schema: z.Nullable(z.String())},
			z.Field{Name: "index", Schema: z.Optional(z.Union(z.Int().Min(0), z.Enum("front", "back", "forward", "backward")))},
		)).Min(1)},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		moves := a.Arr("moves")
		ops := make([]any, len(moves))
		for i, mv := range moves {
			mo := mv.(*jsonv.Object)
			op := jsonv.NewObject("op", "move")
			for _, k := range mo.Keys() {
				v, _ := mo.Get(k)
				op.Set(k, v)
			}
			ops[i] = op
		}
		return write(a, ops, labelOr(a, "move "+count(len(moves))+" node(s)"))
	})

	selectionFrame := z.Object(
		z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)},
		z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
		optStr("id"),
		label(), batch(), workspaceID(),
	)
	writeSelection := func(opName, resultKey, verb, noun string, extra ...string) func(context.Context, *jsonv.Object) (ToolResult, error) {
		return func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			ids := a.Strings("ids")
			id := a.Str("id")
			if !a.Has("id") {
				id = core.NewID()
			}
			kv := make([]any, 0, 6+2*len(extra))
			kv = append(kv, "op", opName, "ids", a.Arr("ids"))
			for _, key := range extra {
				kv = append(kv, key, a.Str(key))
			}
			kv = append(kv, "id", id)
			op := jsonv.NewObject(kv...)
			if a.Has("name") {
				op.Set("name", a.Str("name"))
			}
			return writeWith(a, []any{op}, labelOr(a, verb+" "+count(len(ids))+" "+noun), resultKey, id)
		}
	}
	add("group_nodes", selectionFrame, writeSelection("group", "group", "group", "node(s)"))

	add("ungroup_nodes", z.Object(z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)}, label(), batch(), workspaceID()),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			ids := a.Strings("ids")
			d, err := docOf(a)
			if err != nil {
				return nil, err
			}
			_, released, err := core.UngroupOps(d, ids)
			if err != nil {
				return nil, err
			}
			op := jsonv.NewObject("op", "ungroup", "ids", a.Arr("ids"))
			return writeWith(a, []any{op}, labelOr(a, "ungroup "+count(len(ids))+" group(s)"), "released", jsonv.FromGo(released))
		})

	add("align_nodes", z.Object(
		z.Field{Name: "ids", Schema: z.Array(z.String()).Min(2).Max(500)},
		z.Field{Name: "edge", Schema: z.Enum("left", "center", "right", "top", "middle", "bottom")},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		ids := a.Strings("ids")
		op := jsonv.NewObject("op", "align", "ids", a.Arr("ids"), "edge", a.Str("edge"))
		return write(a, []any{op}, labelOr(a, "align "+count(len(ids))+" node(s) "+a.Str("edge")))
	})

	add("distribute_nodes", z.Object(
		z.Field{Name: "ids", Schema: z.Array(z.String()).Min(3).Max(500)},
		z.Field{Name: "axis", Schema: z.Enum("horizontal", "vertical")},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		ids := a.Strings("ids")
		op := jsonv.NewObject("op", "distribute", "ids", a.Arr("ids"), "axis", a.Str("axis"))
		return write(a, []any{op}, labelOr(a, "distribute "+count(len(ids))+" node(s) "+a.Str("axis")))
	})

	add("wrap_nodes", selectionFrame, writeSelection("wrap", "frame", "wrap", "node(s)"))

	reveal := func(kind, label string) func(context.Context, *jsonv.Object) (ToolResult, error) {
		return func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			d, err := docOf(a)
			if err != nil {
				return nil, err
			}
			ops, ids, err := core.RevealOps(d, kind, a.Str("pageId"))
			if err != nil {
				return nil, err
			}
			if ids == nil {
				ids = []string{}
			}
			if len(ops) == 0 {
				head, err := store.ReadWorkspace(a.Str("workspaceId"))
				if err != nil {
					return nil, wsErr(a.Str("workspaceId"), err)
				}
				out := jsonv.NewObject("ids", jsonv.FromGo(ids), "created", []any{}, "version", float64(head.Version))
				stamp(out, head)
				return jsonResult(out), nil
			}
			op := jsonv.NewObject("op", "reveal", "kind", kind)
			if a.Has("pageId") {
				op.Set("pageId", a.Str("pageId"))
			}
			return writeWith(a, []any{op}, labelOr(a, label), "ids", jsonv.FromGo(ids))
		}
	}
	add("show_all", z.Object(optStr("pageId"), label(), batch(), workspaceID()), reveal("hidden", "show all"))
	add("unlock_all", z.Object(optStr("pageId"), label(), batch(), workspaceID()), reveal("locked", "unlock all"))

	add("combine_paths", z.Object(
		z.Field{Name: "ids", Schema: z.Optional(z.Array(z.String()).Min(2).Max(500))},
		z.Field{Name: "operation", Schema: z.Optional(core.CombineOperationSchema)},
		z.Field{Name: "operations", Schema: z.Optional(z.Array(core.CombineStepSchema).Min(1).Max(50))},
		z.Field{Name: "style", Schema: z.Optional(core.CombineStyleSchema)},
		z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
		optStr("id"),
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		id := a.Str("id")
		if !a.Has("id") {
			id = core.NewID()
		}
		op := jsonv.NewObject("op", "combine_paths")
		for _, k := range []string{"ids", "operation", "operations", "style"} {
			if v, ok := a.Get(k); ok {
				op.Set(k, v)
			}
		}
		op.Set("id", id)
		if a.Has("name") {
			op.Set("name", a.Str("name"))
		}
		lbl := "combine " + count(len(a.Strings("ids"))) + " path(s)"
		if a.Has("operations") {
			lbl = "combine " + count(len(a.Arr("operations"))) + " step(s)"
		}
		return writeWith(a, []any{op}, labelOr(a, lbl), "path", id)
	})

	add("convert_to_path", z.Object(
		z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		ids := a.Strings("ids")
		op := jsonv.NewObject("op", "convert_to_path", "ids", a.Arr("ids"))
		return write(a, []any{op}, labelOr(a, "convert "+count(len(ids))+" node(s) to path"))
	})

	add("round_path_corners", z.Object(
		z.Field{Name: "id", Schema: z.Optional(z.String())},
		z.Field{Name: "d", Schema: z.Optional(z.String().Max(200_000))},
		z.Field{Name: "radius", Schema: z.Optional(z.Number().Min(0).Max(1e6))},
		z.Field{Name: "radii", Schema: z.Optional(z.Array(z.Nullable(z.Number().Min(0).Max(1e6))).Max(10_000))},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		src := a.Str("d")
		id := a.Str("id")
		if id != "" {
			doc, err := docOf(a)
			if err != nil {
				return nil, err
			}
			n := core.GetNode(doc, id)
			if n == nil {
				return nil, fmt.Errorf(`node "%s" does not exist`, id)
			}
			if t := n.Str("type"); t != "path" {
				return nil, fmt.Errorf(`node "%s" is %s, not a path`, id, t)
			}
			if a.Has("d") {
				return nil, errors.New("pass d or id, not both")
			}
			src = n.Str("d")
		}
		if src == "" {
			return nil, errors.New("pass d or id")
		}
		if !a.Has("radius") && !a.Has("radii") {
			return nil, errors.New("pass radius (all corners) or radii (one per vertex)")
		}
		var radii []*float64
		for _, v := range a.Arr("radii") {
			if f, ok := v.(float64); ok {
				radii = append(radii, &f)
			} else {
				radii = append(radii, nil)
			}
		}
		d, err := core.RoundPathCorners(src, a.Num("radius"), radii)
		if err != nil {
			return nil, err
		}
		segs, _ := core.ParsePath(d)
		b := core.PathBounds(segs)
		r := func(v float64) float64 { return jsonv.Round(v*100) / 100 }
		bounds := jsonv.NewObject("x", r(b.X), "y", r(b.Y), "width", r(b.Width), "height", r(b.Height))
		if id == "" {
			return jsonResult(jsonv.NewObject("d", d, "bounds", bounds)), nil
		}
		op := jsonv.NewObject("op", "update", "id", id, "props", jsonv.NewObject("d", d))
		return writeWith(a, []any{op}, labelOr(a, "round corners"), "id", id, "d", d, "bounds", bounds)
	})

	shapeNum := func(name string, min, max float64) z.Field {
		return z.Field{Name: name, Schema: z.Optional(z.Number().Min(min).Max(max))}
	}
	add("create_shape_path", z.Object(
		z.Field{Name: "kind", Schema: z.Enum(core.PathShapeKinds...)},
		z.Field{Name: "x", Schema: z.Optional(z.Number())},
		z.Field{Name: "y", Schema: z.Optional(z.Number())},
		shapeNum("radius", 0.01, 1e6), shapeNum("points", 3, 100), shapeNum("sides", 3, 100),
		shapeNum("innerRadius", 0.01, 1e6), shapeNum("thickness", 0.01, 1e6), shapeNum("angle", -3600, 3600),
		shapeNum("startAngle", -3600, 3600), shapeNum("endAngle", -3600, 3600), shapeNum("cornerRadius", 0, 1e6),
		z.Field{Name: "roundCaps", Schema: z.Optional(z.Bool())},
		optStr("id"), optStr("name"),
		z.Field{Name: "props", Schema: z.Optional(z.Record(z.String(), z.Unknown()))},
		z.Field{Name: "parentId", Schema: z.Optional(z.Nullable(z.String()))},
		z.Field{Name: "index", Schema: z.Optional(z.Int().Min(0))},
		z.Field{Name: "place", Schema: placeSchema},
		label(), batch(), workspaceID(),
	), func(ctx context.Context, a *jsonv.Object) (ToolResult, error) {
		shape, err := core.BuildPathShape(a.Str("kind"), core.ShapeParamsFromJSON(a))
		if err != nil {
			return nil, err
		}
		node := jsonv.NewObject("type", "path")
		if a.Has("id") {
			node.Set("id", a.Str("id"))
		}
		if a.Has("name") {
			node.Set("name", a.Str("name"))
		}
		props := a.Obj("props")
		if props != nil {
			for _, k := range props.Keys() {
				switch k {
				case "type", "d", "x", "y", "width", "height", "viewBox", "children":
					return nil, fmt.Errorf(`props.%s is computed from the shape (x and y are the center: pass them at the top level)`, k)
				}
				v, _ := props.Get(k)
				node.Set(k, v)
			}
		}
		if a.Has("x") {
			node.Set("x", jsonv.Round((a.Num("x")-shape.Center.X)*100)/100)
		}
		if a.Has("y") {
			node.Set("y", jsonv.Round((a.Num("y")-shape.Center.Y)*100)/100)
		}
		node.Set("width", shape.Width)
		node.Set("height", shape.Height)
		node.Set("d", shape.D)
		if shape.EvenOdd && !node.Has("fillRule") {
			node.Set("fillRule", "evenodd")
		}
		if !node.Has("fill") && !node.Has("gradient") && !node.Has("stroke") {
			node.Set("fill", "#000000")
		}
		args := jsonv.NewObject("nodes", []any{node})
		for _, k := range []string{"parentId", "index", "place", "label", "batch", "workspaceId"} {
			if v, ok := a.Get(k); ok {
				args.Set(k, v)
			}
		}
		if !a.Has("label") {
			args.Set("label", "create "+a.Str("kind")+" shape")
		}
		return m.tools["create_nodes"].handler(ctx, args)
	})

	add("create_page", z.Object(
		z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
		optStr("id"),
		z.Field{Name: "ensure", Schema: z.Optional(z.Bool())},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		if a.Bool("ensure") {
			if !a.Has("name") || strings.TrimSpace(a.Str("name")) == "" {
				return nil, errors.New("create_page ensure requires a name")
			}
			head, err := store.ReadWorkspace(a.Str("workspaceId"))
			if err != nil {
				return nil, wsErr(a.Str("workspaceId"), err)
			}
			if existing := pageByName(head.Doc, a.Str("name")); existing != "" {
				out := jsonv.NewObject(
					"page", existing,
					"created", []any{},
					"ensured", true,
					"version", float64(head.Version),
				)
				stamp(out, head)
				return jsonResult(out), nil
			}
		}
		id := a.Str("id")
		if !a.Has("id") {
			id = core.NewID()
		}
		op := jsonv.NewObject("op", "add_page", "id", id)
		if a.Has("name") {
			op.Set("name", a.Str("name"))
		}
		// `page` names the new page: `created` also lists the first page ("Page 1") made when the document already had content.
		return writeWith(a, []any{op}, labelOr(a, "create page"), "page", id)
	})

	add("create_component", z.Object(
		z.Field{Name: "id", Schema: z.String()},
		z.Field{Name: "props", Schema: z.Optional(z.Array(componentPropArg()).Max(24))},
		label(), batch(), workspaceID(),
	),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			id := a.Str("id")
			props := jsonv.NewObject("component", true)
			if v, ok := a.Get("props"); ok {
				props.Set("componentProps", v)
			}
			op := jsonv.NewObject("op", "update", "id", id, "props", props)
			return writeWith(a, []any{op}, labelOr(a, "create component"), "component", id)
		})

	add("create_instance", z.Object(
		z.Field{Name: "componentId", Schema: z.String()},
		z.Field{Name: "parentId", Schema: z.Optional(z.Nullable(z.String()))},
		z.Field{Name: "x", Schema: z.Optional(z.Number())},
		z.Field{Name: "y", Schema: z.Optional(z.Number())},
		z.Field{Name: "scale", Schema: z.Optional(z.Number().Min(0.01).Max(100))},
		z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
		z.Field{Name: "overrides", Schema: z.Optional(z.Record(z.String(), z.Record(z.String(), z.Unknown())))},
		z.Field{Name: "propValues", Schema: z.Optional(z.Record(propNameArg(), z.Union(z.String().Max(2000), z.Bool())))},
		z.Field{Name: "slots", Schema: z.Optional(z.Record(propNameArg(), z.Array(z.String()).Max(40)))},
		optStr("id"),
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		compID := a.Str("componentId")
		d, err := docOf(a)
		if err != nil {
			return nil, err
		}
		comp := core.GetNode(d, compID)
		iid := a.Str("id")
		if !a.Has("id") {
			iid = core.NewID()
		}
		scene := comp != nil && comp.Str("type") != "page"
		node := jsonv.NewObject("type", "frame", "id", iid, "instanceOf", compID)
		switch {
		case a.Has("name"):
			node.Set("name", a.Str("name"))
		case comp != nil:
			node.Set("name", comp.Str("name"))
		default:
			node.Set("name", "")
		}
		if v, ok := a.Get("x"); ok {
			node.Set("x", v)
		} else if scene {
			w, _ := comp.Get("width")
			wf, _ := w.(float64)
			node.Set("x", comp.Num("x")+wf+40)
		} else {
			node.Set("x", 0.0)
		}
		if v, ok := a.Get("y"); ok {
			node.Set("y", v)
		} else if scene {
			node.Set("y", comp.Num("y"))
		} else {
			node.Set("y", 0.0)
		}
		if v, ok := a.Get("scale"); ok {
			node.Set("scale", v)
		}
		if v, ok := a.Get("overrides"); ok {
			node.Set("overrides", v)
		}
		if v, ok := a.Get("propValues"); ok {
			node.Set("propValues", v)
		}
		if v, ok := a.Get("slots"); ok {
			node.Set("slots", v)
		}
		var parent any
		if v, ok := a.Get("parentId"); ok {
			parent = v
		} else if comp != nil {
			parent, _ = comp.Get("parentId")
		}
		op := jsonv.NewObject("op", "create", "parentId", parent, "node", node)
		copies := jsonv.NewObject()
		var walk func(root, inst string)
		walk = func(root, inst string) {
			n := core.GetNode(d, root)
			if n == nil || !core.IsContainer(n.Str("type")) {
				return
			}
			for _, c := range n.Strings("children") {
				ch := core.GetNode(d, c)
				if ch == nil || ch.Has("sourceId") {
					continue
				}
				cid := core.CopyID(inst, c)
				copies.Set(c, cid)
				if core.IsInstance(ch) {
					walk(ch.Str("instanceOf"), cid)
				} else {
					walk(c, inst)
				}
			}
		}
		walk(compID, iid)
		if sl := a.Obj("slots"); sl != nil {
			frames := map[string]string{}
			var find func(id string)
			find = func(id string) {
				n := core.GetNode(d, id)
				if n == nil || !core.IsContainer(n.Str("type")) {
					return
				}
				for _, c := range n.Strings("children") {
					ch := core.GetNode(d, c)
					if ch == nil || ch.Has("sourceId") {
						continue
					}
					if name := ch.Str("slot"); name != "" {
						frames[name] = c
					}
					if !core.IsInstance(ch) {
						find(c)
					}
				}
			}
			find(compID)
			for _, name := range sl.Keys() {
				frame := frames[name]
				if frame == "" {
					continue
				}
				for _, src := range sl.Strings(name) {
					copies.Set(name+"/"+src, core.CopyID(iid, frame+"/"+src))
				}
			}
		}
		return writeWith(a, []any{op}, labelOr(a, "create instance"), "instance", iid, "copies", copies)
	})

	add("detach_instance", z.Object(z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)}, label(), batch(), workspaceID()),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			ids := a.Strings("ids")
			op := jsonv.NewObject("op", "detach", "ids", a.Arr("ids"))
			return writeWith(a, []any{op}, labelOr(a, "detach "+count(len(ids))+" instance(s)"), "detached", a.Arr("ids"))
		})

	add("detach_tokens", z.Object(
		z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)},
		z.Field{Name: "fields", Schema: z.Optional(z.Array(z.String()).Min(1).Max(40))},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		op := jsonv.NewObject("op", "detach_tokens", "ids", a.Arr("ids"))
		if a.Has("fields") {
			op.Set("fields", a.Arr("fields"))
		}
		// Fields that come from a component (on an instance or its copies) are skipped, not an error.
		extra := []any{"detached", a.Arr("ids")}
		if d, err := docOf(a); err == nil {
			if skipped := core.DetachTokensSkipped(d, a.Strings("ids"), a.Strings("fields")); len(skipped) > 0 {
				sk := jsonv.NewObject()
				for id, f := range skipped {
					sk.Set(id, jsonv.FromGo(f))
				}
				extra = append(extra, "skipped", sk)
			}
		}
		return writeWith(a, []any{op}, labelOr(a, "detach tokens"), extra...)
	})

	add("apply_ops", z.Object(z.Field{Name: "ops", Schema: z.Array(core.OpSchema).Min(1).Max(1000)}, label(), batch(), workspaceID()),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			ops := a.Arr("ops")
			return write(a, ops, labelOr(a, "transaction of "+count(len(ops))+" op(s)"))
		})

	add("propose_tokens", z.Object(
		z.Field{Name: "content", Schema: z.String().Min(1).Max(200_000)},
		z.Field{Name: "format", Schema: z.Default(z.Enum("auto", "css", "tailwind", "json"), "auto")},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		out, err := proposeFromContent(a.Str("content"), a.Str("format"))
		if err != nil {
			return nil, err
		}
		return jsonResult(out), nil
	})

	add("set_tokens", z.Object(
		z.Field{Name: "tokens", Schema: z.Record(z.String(), z.Union(z.String(), z.Number(), z.Null()))},
		z.Field{Name: "type", Schema: z.Optional(z.Nullable(core.TokenTypeSchema))},
		z.Field{Name: "collection", Schema: z.Optional(z.Nullable(core.CollectionNameSchema))},
		optStr("mode"),
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		tokens, _ := a.Get("tokens")
		op := jsonv.NewObject("op", "set_tokens", "tokens", tokens)
		if a.Has("type") {
			v, _ := a.Get("type")
			op.Set("type", v)
		}
		if a.Has("collection") {
			v, _ := a.Get("collection")
			op.Set("collection", v)
		}
		if m := a.Str("mode"); m != "" {
			op.Set("mode", m)
		}
		return write(a, []any{op}, labelOr(a, "tokens"))
	})

	add("set_assets", z.Object(
		z.Field{Name: "assets", Schema: z.Record(z.String(), z.Union(z.String(), z.Null()))},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		assets, _ := a.Get("assets")
		op := jsonv.NewObject("op", "set_assets", "assets", assets)
		return write(a, []any{op}, labelOr(a, "assets"))
	})

	stepResult := func(key string, ok bool, head WorkspaceHead) ToolResult {
		out := jsonv.NewObject(key, ok, "version", float64(head.Version), "canUndo", head.CanUndo, "canRedo", head.CanRedo)
		stamp(out, head)
		return jsonResult(out)
	}
	add("undo", z.Object(workspaceID()), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		ok, head, err := store.StepIn(a.Str("workspaceId"), m.actorName(), false)
		if err != nil {
			return nil, wsErr(a.Str("workspaceId"), err)
		}
		return stepResult("undone", ok, head), nil
	})
	add("redo", z.Object(workspaceID()), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		ok, head, err := store.StepIn(a.Str("workspaceId"), m.actorName(), true)
		if err != nil {
			return nil, wsErr(a.Str("workspaceId"), err)
		}
		return stepResult("redone", ok, head), nil
	})

	add("get_history", z.Object(
		z.Field{Name: "limit", Schema: z.Default(z.Int().Min(1).Max(200), 20.0)},
		workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		entries, err := store.RecentHistoryIn(a.Str("workspaceId"), int(a.Num("limit")))
		if err != nil {
			return nil, wsErr(a.Str("workspaceId"), err)
		}
		shown := jsonv.FromGo(entries)
		return jsonShown(jsonv.NewObject("entries", shown), shown), nil
	})

	add("list_workspaces", z.Object(
		z.Field{Name: "includeArchived", Schema: z.Optional(z.Bool())},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		ws, err := store.ListWorkspacesFiltered(a.Bool("includeArchived"), false)
		if err != nil {
			return nil, err
		}
		folders, err := store.ListFolders()
		if err != nil {
			return nil, err
		}
		return jsonResult(jsonv.NewObject("active", store.DocID(), "workspaces", jsonv.FromGo(ws), "folders", jsonv.FromGo(folders))), nil
	})
	add("open_workspace", z.Object(z.Field{Name: "id", Schema: z.String().Min(1)}),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			id := a.Str("id")
			info, err := store.OpenWorkspace(id, m.actorName())
			if errors.Is(err, ErrNoWorkspace) {
				return nil, fmt.Errorf(`workspace "%s" does not exist (see list_workspaces)`, id)
			}
			if err != nil {
				return nil, err
			}
			return jsonResult(jsonv.NewObject("workspace", jsonv.FromGo(info), "version", float64(store.Version()))), nil
		})
	add("create_workspace", z.Object(z.Field{Name: "name", Schema: z.String().Max(120)}),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			info, err := store.CreateWorkspace(a.Str("name"), m.actorName())
			if err != nil {
				return nil, err
			}
			return jsonResult(jsonv.NewObject("workspace", jsonv.FromGo(info))), nil
		})
	add("create_folder", z.Object(z.Field{Name: "name", Schema: z.String().Min(1).Max(120)}),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			folder, err := store.CreateFolder(a.Str("name"))
			if err != nil {
				return nil, err
			}
			return jsonResult(jsonv.NewObject("folder", jsonv.FromGo(folder))), nil
		})
	add("rename_folder", z.Object(
		z.Field{Name: "id", Schema: z.String().Min(1)},
		z.Field{Name: "name", Schema: z.String().Min(1).Max(120)},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		id := a.Str("id")
		folder, err := store.RenameFolder(id, a.Str("name"))
		if errors.Is(err, ErrNoFolder) {
			return nil, fmt.Errorf(`folder "%s" does not exist (see list_workspaces)`, id)
		}
		if err != nil {
			return nil, err
		}
		return jsonResult(jsonv.NewObject("folder", jsonv.FromGo(folder))), nil
	})
	add("move_workspace", z.Object(
		z.Field{Name: "id", Schema: z.String().Min(1)},
		z.Field{Name: "folderId", Schema: z.Nullable(z.String().Max(64))},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		id := a.Str("id")
		folderID := ""
		if v, ok := a.Get("folderId"); ok && v != nil {
			s, ok := v.(string)
			if !ok {
				return nil, errors.New("folderId must be a string or null")
			}
			folderID = s
		}
		info, err := store.MoveWorkspace(id, folderID, m.actorName())
		switch {
		case errors.Is(err, ErrNoWorkspace):
			return nil, fmt.Errorf(`workspace "%s" does not exist (see list_workspaces)`, id)
		case errors.Is(err, ErrNoFolder):
			return nil, fmt.Errorf(`folder "%s" does not exist (see list_workspaces)`, strings.TrimSpace(folderID))
		case err != nil:
			return nil, err
		}
		return jsonResult(jsonv.NewObject("workspace", jsonv.FromGo(info))), nil
	})

	add("import_document", z.Object(
		z.Field{Name: "document", Schema: z.Object(z.Field{Name: "format", Schema: z.Optional(z.String())}).Catchall(z.Unknown())},
		z.Field{Name: "name", Schema: z.Optional(z.String().Max(120))},
		z.Field{Name: "place", Schema: placeSchema},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		doc, _ := a.Get("document")
		info, err := store.ImportWorkspace(doc, a.Str("name"), m.actorName())
		if err != nil {
			return nil, err
		}
		out := jsonv.NewObject("workspace", jsonv.FromGo(info), "active", store.DocID())
		if a.Has("place") {
			if p, _ := a.Get("place"); p != "none" {
				out.Set("warnings", []any{`import_document keeps the file's coordinates (place "none"): it stores a separate workspace. Use import_svg, import_html or import_image to place artwork on the current page`})
			}
		}
		return jsonResult(out), nil
	})

	add("rename_workspace", z.Object(z.Field{Name: "id", Schema: z.String().Min(1)}, z.Field{Name: "name", Schema: z.String().Min(1).Max(120)}),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			id := a.Str("id")
			info, err := store.RenameWorkspace(id, a.Str("name"), m.actorName())
			if errors.Is(err, ErrNoWorkspace) {
				return nil, fmt.Errorf(`workspace "%s" does not exist (see list_workspaces)`, id)
			}
			if err != nil {
				return nil, err
			}
			return jsonResult(jsonv.NewObject("workspace", jsonv.FromGo(info))), nil
		})
	add("archive_workspace", z.Object(z.Field{Name: "id", Schema: z.String().Min(1)}),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			id := a.Str("id")
			info, err := store.ArchiveWorkspace(id, m.actorName())
			if err != nil {
				return nil, workspaceActionError(id, err)
			}
			return jsonResult(jsonv.NewObject("workspace", jsonv.FromGo(info), "active", store.DocID())), nil
		})
	add("unarchive_workspace", z.Object(z.Field{Name: "id", Schema: z.String().Min(1)}),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			id := a.Str("id")
			info, err := store.UnarchiveWorkspace(id, m.actorName())
			if err != nil {
				return nil, workspaceActionError(id, err)
			}
			return jsonResult(jsonv.NewObject("workspace", jsonv.FromGo(info), "active", store.DocID())), nil
		})
	add("delete_workspace", z.Object(
		z.Field{Name: "id", Schema: z.String().Min(1)},
		optStr("confirmToken"),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		id, token := a.Str("id"), a.Str("confirmToken")
		if token == "" {
			// Nothing is deleted here. The call returns what would be lost and a token bound to this
			// workspace: the agent shows the summary to the human, then repeats the call with the token.
			summary, err := store.DescribeWorkspaceDeletion(id)
			if err != nil {
				return nil, workspaceActionError(id, err)
			}
			issued, ttl, err := store.IssueDeleteConfirm(id)
			if err != nil {
				return nil, workspaceActionError(id, err)
			}
			return jsonResult(jsonv.NewObject(
				"needsConfirmation", true,
				"summary", jsonv.FromGo(summary),
				"confirmToken", issued,
				"expiresInMs", float64(ttl),
			)), nil
		}
		if err := store.ConsumeDeleteConfirm(id, token); err != nil {
			switch {
			case errors.Is(err, ErrExpiredConfirmToken):
				return nil, fmt.Errorf(`confirmToken for workspace "%s" has expired: call delete_workspace without a token for a fresh summary`, id)
			case errors.Is(err, ErrBadConfirmToken):
				return nil, fmt.Errorf(`confirmToken is not valid for workspace "%s": it is single-use and tied to one workspace, so call delete_workspace without a token again to get the summary and a new token`, id)
			default:
				return nil, workspaceActionError(id, err)
			}
		}
		active, err := store.DeleteWorkspace(id, m.actorName())
		if err != nil {
			return nil, workspaceActionError(id, err)
		}
		return jsonResult(jsonv.NewObject("deleted", id, "active", active, "notice", "tell the human what was deleted: see list_workspace_ops for the entry")), nil
	})

	add("list_workspace_ops", z.Object(
		z.Field{Name: "limit", Schema: z.Default(z.Int().Min(1).Max(200), 20.0)},
		optStr("workspaceId"),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		entries, err := store.ListWorkspaceOps(int(a.Num("limit")), a.Str("workspaceId"))
		if err != nil {
			return nil, err
		}
		return jsonShown(jsonv.NewObject("entries", jsonv.FromGo(entries)), jsonv.FromGo(entries)), nil
	})

	add("set_workspace_cover", z.Object(
		z.Field{Name: "id", Schema: z.String().Min(1)},
		optStr("rootId"),
		optStr("image"),
		z.Field{Name: "clear", Schema: z.Optional(z.Bool())},
	), func(ctx context.Context, a *jsonv.Object) (ToolResult, error) {
		id := a.Str("id")
		var info WorkspaceInfo
		var err error
		switch {
		case a.Bool("clear"):
			if a.Str("image") != "" || a.Str("rootId") != "" {
				return nil, errors.New("pass only one of rootId, image or clear")
			}
			info, err = store.ClearCover(id)
		case a.Str("image") != "":
			if a.Str("rootId") != "" {
				return nil, errors.New("pass only one of rootId, image or clear")
			}
			raw := a.Str("image")
			if i := strings.Index(raw, ";base64,"); strings.HasPrefix(raw, "data:") && i > 0 {
				raw = raw[i+len(";base64,"):]
			}
			data, derr := base64.StdEncoding.DecodeString(raw)
			if derr != nil {
				return nil, errors.New("image must be base64 (or a data: URL with ;base64,)")
			}
			info, err = store.SetCover(id, data)
		default:
			if m.shot == nil {
				return nil, errors.New("screenshot unavailable on this server: pass image instead")
			}
			doc, derr := store.WorkspaceDocument(id)
			if derr != nil {
				err = derr
				break
			}
			png, _, _, serr := m.shot.ScreenshotMode(ctx, doc, a.Str("rootId"), 1, "")
			if serr != nil {
				return nil, serr
			}
			info, err = store.SetCover(id, png)
		}
		switch {
		case errors.Is(err, ErrNoWorkspace):
			return nil, fmt.Errorf(`workspace "%s" does not exist (see list_workspaces)`, id)
		case errors.Is(err, ErrBadCover):
			return nil, fmt.Errorf("%w (a screenshot that big: pass a smaller rootId)", err)
		case err != nil:
			return nil, err
		}
		return jsonResult(jsonv.NewObject("workspace", jsonv.FromGo(info))), nil
	})

	add("lint_design", z.Object(
		optStr("rootId"),
		z.Field{Name: "rootIds", Schema: z.Optional(z.Array(z.String()).Max(50))},
		z.Field{Name: "minSeverity", Schema: z.Optional(z.Enum("info", "warning", "error"))},
		z.Field{Name: "minFontSize", Schema: z.Optional(z.Number().Min(1).Max(1000))},
		z.Field{Name: "maxIds", Schema: z.Default(z.Int().Min(1).Max(50), 8.0)},
		workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		d, err := docOf(a)
		if err != nil {
			return nil, err
		}
		roots := []string{}
		if id := a.Str("rootId"); id != "" {
			roots = append(roots, id)
		}
		roots = append(roots, a.Strings("rootIds")...)
		seen := map[string]bool{}
		opts := core.LintOpts{MinSeverity: a.Str("minSeverity")}
		for _, id := range roots {
			if seen[id] {
				continue
			}
			seen[id] = true
			if core.GetNode(d, id) == nil {
				return nil, fmt.Errorf(`node "%s" does not exist`, id)
			}
			if opts.RootID == "" {
				opts.RootID = id
			} else {
				opts.RootIDs = append(opts.RootIDs, id)
			}
		}
		if _, ok := a.Get("minFontSize"); ok {
			opts.MinFontSize = a.Num("minFontSize")
		}
		issues := core.LintDocumentOpts(d, opts)
		maxIDs := int(a.Num("maxIds"))
		groups := core.GroupLint(issues, maxIDs)
		counts := map[string]int{"error": 0, "warning": 0, "info": 0}
		for _, i := range issues {
			counts[i.Severity]++
		}
		return jsonResult(jsonv.NewObject(
			"ok", counts["error"] == 0,
			"counts", jsonv.NewObject("error", float64(counts["error"]), "warning", float64(counts["warning"]), "info", float64(counts["info"])),
			"groups", jsonv.FromGo(groups),
			"issues", jsonv.FromGo(issues),
		)), nil
	})

	add("render_screenshot", z.Object(
		optStr("rootId"),
		z.Field{Name: "scale", Schema: z.Default(z.Number().Min(0.1).Max(4), 1.0)},
		optStr("path"),
		z.Field{Name: "mode", Schema: z.Optional(core.ModeNameSchema)},
		optStr("compare"),
		z.Field{Name: "grid", Schema: z.Optional(z.Union(z.Bool(), z.Object(
			z.Field{Name: "step", Schema: z.Optional(z.Number().Positive())},
			z.Field{Name: "labels", Schema: z.Optional(z.Bool())},
			optStr("color"),
		)))},
		z.Field{Name: "region", Schema: z.Optional(z.Object(
			z.Field{Name: "x", Schema: z.Number()},
			z.Field{Name: "y", Schema: z.Number()},
			z.Field{Name: "width", Schema: z.Number().Positive()},
			z.Field{Name: "height", Schema: z.Number().Positive()},
		))},
		workspaceID(),
	), func(ctx context.Context, a *jsonv.Object) (ToolResult, error) {
		if m.shot == nil {
			return nil, errors.New("screenshot unavailable on this server")
		}
		d, err := docOf(a)
		if err != nil {
			return nil, err
		}
		png, w, h, err := m.shot.ScreenshotMode(ctx, d, a.Str("rootId"), a.Num("scale"), a.Str("mode"))
		if err != nil {
			return nil, err
		}
		grid, err := parseGridArg(a)
		if err != nil {
			return nil, err
		}
		region := parseRegionArg(a)
		var gridStep float64
		var usedRegion *Region
		if grid != nil || region != nil {
			fw, fh := frameSize(d, a.Str("rootId"), w, h, a.Num("scale"))
			png, w, h, gridStep, usedRegion, err = annotateShot(png, fw, fh, float64(w)/fw, region, grid)
			if err != nil {
				return nil, err
			}
		}
		compared := false
		if src := strings.TrimSpace(a.Str("compare")); src != "" {
			img, _, lerr := loadImportImage(src)
			if lerr != nil {
				return nil, lerr
			}
			png, w, h, err = composeSideBySide(png, img.data)
			if err != nil {
				return nil, err
			}
			compared = true
		}
		shotText := fmt.Sprintf("%d×%dpx", w, h)
		if compared {
			shotText += " side by side"
		}
		if gridStep > 0 {
			shotText += ", grid step " + formatGridValue(gridStep)
		}
		if usedRegion != nil {
			shotText += fmt.Sprintf(", region x=%s y=%s %s×%s", formatGridValue(usedRegion.X), formatGridValue(usedRegion.Y), formatGridValue(usedRegion.W), formatGridValue(usedRegion.H))
		}
		extras := func(o *jsonv.Object) {
			if gridStep > 0 {
				o.Set("grid", jsonv.NewObject("step", gridStep))
			}
			if usedRegion != nil {
				o.Set("region", jsonv.NewObject("x", usedRegion.X, "y", usedRegion.Y, "width", usedRegion.W, "height", usedRegion.H))
			}
		}
		if rel := a.Str("path"); rel != "" {
			abs, werr := writeScreenshot(store.Path(), rel, png)
			if werr != nil {
				return nil, werr
			}
			out := jsonv.NewObject("path", abs, "width", float64(w), "height", float64(h))
			if url := screenshotURL(m.shot, png); url != "" {
				out.Set("url", url)
			}
			if compared {
				out.Set("compare", true)
			}
			extras(out)
			return jsonResult(out), nil
		}
		structured := jsonv.NewObject("width", float64(w), "height", float64(h))
		if url := screenshotURL(m.shot, png); url != "" {
			structured.Set("url", url)
		}
		if compared {
			structured.Set("compare", true)
		}
		extras(structured)
		return jsonv.NewObject("content", []any{
			jsonv.NewObject("type", "image", "data", base64.StdEncoding.EncodeToString(png), "mimeType", "image/png"),
			jsonv.NewObject("type", "text", "text", shotText),
		}, "structuredContent", structured), nil
	})

	add("export_image", z.Object(
		optStr("rootId"),
		z.Field{Name: "format", Schema: z.Default(z.Enum("png", "jpeg", "webp", "avif", "pdf", "svg"), "png")},
		z.Field{Name: "scale", Schema: z.Default(z.Number().Min(0.1).Max(4), 1.0)},
		workspaceID(),
	), func(ctx context.Context, a *jsonv.Object) (ToolResult, error) {
		d, err := docOf(a)
		if err != nil {
			return nil, err
		}
		if a.Str("format") == "svg" {
			// Same vector SVG as export_code {format: "svg"}; scale does not apply.
			r, err := core.ExportSVG(d, a.Str("rootId"), nil)
			if err != nil {
				return nil, err
			}
			content := []any{jsonv.NewObject("type", "text", "text", r.SVG)}
			if len(r.Warnings) > 0 {
				content = append(content, jsonv.NewObject("type", "text", "text", "warnings: "+strings.Join(r.Warnings, "; ")))
			}
			sc := jsonv.NewObject(
				"width", math.Ceil(r.Width),
				"height", math.Ceil(r.Height),
				"format", "svg",
				"mimeType", "image/svg+xml",
				"warnings", jsonv.FromGo(r.Warnings),
			)
			return jsonv.NewObject("content", content, "structuredContent", sc), nil
		}
		out, err := m.exportImage(ctx, d, a.Str("rootId"), a.Str("format"), a.Num("scale"))
		if err != nil {
			return nil, err
		}
		content := []any{
			jsonv.NewObject("type", "image", "data", base64.StdEncoding.EncodeToString(out.Data), "mimeType", out.Mime),
			jsonv.NewObject("type", "text", "text", fmt.Sprintf("%d×%d %s", out.Width, out.Height, out.Format)),
		}
		sc := jsonv.NewObject(
			"width", float64(out.Width),
			"height", float64(out.Height),
			"format", out.Format,
			"mimeType", out.Mime,
			"warnings", jsonv.FromGo(out.Warnings),
		)
		return jsonv.NewObject("content", content, "structuredContent", sc), nil
	})

	add("export_code", z.Object(
		z.Field{Name: "rootId", Schema: z.String()},
		z.Field{Name: "format", Schema: z.Default(z.Enum("html", "react", "svg", "tailwind", "tailwind-html", "css-modules", "angular", "svelte"), "react")},
		z.Field{Name: "cssVariables", Schema: z.Default(z.Bool(), false)},
		workspaceID(),
	), func(ctx context.Context, a *jsonv.Object) (ToolResult, error) {
		d, err := docOf(a)
		if err != nil {
			return nil, err
		}
		switch a.Str("format") {
		case "html":
			html, _, err := core.RenderHTML(d, core.RenderOptions{RootID: a.Str("rootId"), CSSVariables: a.Bool("cssVariables")})
			if err != nil {
				return nil, err
			}
			return textResult(html), nil
		case "react":
			code, err := core.ExportReact(d, a.Str("rootId"), a.Bool("cssVariables"))
			if err != nil {
				return nil, err
			}
			return textResult(code), nil
		case "tailwind":
			code, err := core.ExportTailwind(d, a.Str("rootId"), a.Bool("cssVariables"))
			if err != nil {
				return nil, err
			}
			return textResult(code), nil
		case "tailwind-html":
			html, _, err := core.RenderTailwindHTML(d, core.RenderOptions{RootID: a.Str("rootId"), CSSVariables: a.Bool("cssVariables")})
			if err != nil {
				return nil, err
			}
			return textResult(html), nil
		case "css-modules":
			mod, err := core.ExportCSSModules(d, a.Str("rootId"), a.Bool("cssVariables"))
			if err != nil {
				return nil, err
			}
			return jsonv.NewObject("content", []any{
				jsonv.NewObject("type", "text", "text", "// "+strings.TrimSuffix(mod.FileName, ".module.css")+".tsx\n"+mod.Component),
				jsonv.NewObject("type", "text", "text", "/* "+mod.FileName+" */\n"+mod.CSS),
			}), nil
		case "angular":
			ang, err := core.ExportAngular(d, a.Str("rootId"), a.Bool("cssVariables"))
			if err != nil {
				return nil, err
			}
			return jsonv.NewObject("content", []any{
				jsonv.NewObject("type", "text", "text", "// "+ang.FileBase+".component.ts\n"+ang.Typescript),
				jsonv.NewObject("type", "text", "text", "<!-- "+ang.FileBase+".component.html -->\n"+ang.Template),
				jsonv.NewObject("type", "text", "text", "/* "+ang.FileBase+".component.css */\n"+ang.Styles),
			}), nil
		case "svelte":
			sv, err := core.ExportSvelte(d, a.Str("rootId"), a.Bool("cssVariables"))
			if err != nil {
				return nil, err
			}
			return textResult("<!-- " + sv.FileName + " -->\n" + sv.Source), nil
		}
		r, err := core.ExportSVG(d, a.Str("rootId"), nil)
		if err != nil {
			return nil, err
		}
		content := []any{jsonv.NewObject("type", "text", "text", r.SVG)}
		if len(r.Warnings) > 0 {
			content = append(content, jsonv.NewObject("type", "text", "text", "warnings: "+strings.Join(r.Warnings, "; ")))
		}
		return jsonv.NewObject("content", content), nil
	})

	importFields := func(first ...z.Field) *z.ObjectSchema {
		return z.Object(append(first,
			z.Field{Name: "parentId", Schema: z.Optional(z.Nullable(z.String()))},
			z.Field{Name: "x", Schema: z.Optional(z.Number())},
			z.Field{Name: "y", Schema: z.Optional(z.Number())},
			z.Field{Name: "place", Schema: placeSchema},
			label(), batch(), workspaceID(),
		)...)
	}
	importWrite := func(r core.ImportResult, a *jsonv.Object, def string) (ToolResult, error) {
		if len(r.Nodes) == 0 {
			msg := strings.Join(r.Warnings, "; ")
			if msg == "" {
				msg = "nothing to import"
			}
			return nil, errors.New(msg)
		}
		parent, _ := a.Get("parentId")
		here, err := docOf(a)
		if err != nil {
			return nil, err
		}
		p, usePlace := importPlace(here, a)
		if !usePlace && a.Str("place") == "none" && (a.Has("x") || a.Has("y")) {
			for _, n := range r.Nodes {
				if w := pinAbsolute(here, parent, n); w != "" {
					r.Warnings = append(r.Warnings, w)
				}
			}
		}
		ops := make([]any, len(r.Nodes))
		for i, n := range r.Nodes {
			op := jsonv.NewObject("op", "create", "parentId", parent, "node", n)
			if usePlace {
				op.Set("place", p)
			}
			ops[i] = op
		}
		res, head, err := applyHere(a, ops, labelOr(a, def))
		if err != nil {
			return nil, err
		}
		ws := make([]any, len(r.Warnings))
		for i, w := range r.Warnings {
			ws[i] = w
		}
		for _, w := range core.OverlapWarnings(head.Doc, res.Created) {
			ws = append(ws, w)
		}
		out := jsonv.NewObject("created", []any{}, "version", float64(head.Version), "warnings", ws)
		stamp(out, head)
		return resultWithRoots(out, head.Doc, res.Created), nil
	}
	importOpts := func(a *jsonv.Object) core.ImportOptions {
		o := core.ImportOptions{X: a.Num("x"), Y: a.Num("y")}
		if a.Has("name") {
			n := a.Str("name")
			o.Name = &n
		}
		return o
	}
	add("draw_diagram", z.Object(
		z.Field{Name: "parentId", Schema: z.Optional(z.Nullable(z.String()))},
		z.Field{Name: "direction", Schema: z.Default(z.Enum("down", "right"), "down")},
		z.Field{Name: "gap", Schema: z.Default(z.Number().Min(0).Max(2000), 64.0)},
		z.Field{Name: "x", Schema: z.Optional(z.Number())},
		z.Field{Name: "y", Schema: z.Optional(z.Number())},
		z.Field{Name: "relayout", Schema: z.Default(z.Bool(), false)},
		z.Field{Name: "nodes", Schema: z.Default(z.Array(z.Object(
			z.Field{Name: "id", Schema: z.String().Regex(`^[A-Za-z0-9_-]{1,64}$`, `/^[A-Za-z0-9_-]{1,64}$/`, "id must be [A-Za-z0-9_-]{1,64}")},
		).Catchall(z.Unknown())).Max(500), []any{})},
		z.Field{Name: "edges", Schema: z.Default(z.Array(z.Object(
			z.Field{Name: "from", Schema: z.String()},
			z.Field{Name: "to", Schema: z.String()},
			optStr("id"),
			z.Field{Name: "fromSide", Schema: z.Optional(core.ConnectorSideSchema)},
			z.Field{Name: "toSide", Schema: z.Optional(core.ConnectorSideSchema)},
			z.Field{Name: "route", Schema: z.Optional(z.Enum("straight", "elbow", "rounded", "curve"))},
			z.Field{Name: "radius", Schema: z.Optional(z.Number().Min(0).Max(1000))},
			z.Field{Name: "control", Schema: z.Optional(z.Object(
				z.Field{Name: "x", Schema: z.Number()},
				z.Field{Name: "y", Schema: z.Number()},
			))},
			z.Field{Name: "startArrow", Schema: z.Optional(z.Enum("none", "arrow"))},
			z.Field{Name: "endArrow", Schema: z.Optional(z.Enum("none", "arrow"))},
			z.Field{Name: "dashed", Schema: z.Optional(z.Bool())},
			z.Field{Name: "stroke", Schema: z.Optional(core.StrokeSchema)},
			z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
			z.Field{Name: "label", Schema: z.Optional(z.String().Max(200))},
		)).Max(1000), []any{})},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		d, err := docOf(a)
		if err != nil {
			return nil, err
		}
		plan, err := core.DiagramOps(d, a)
		if err != nil {
			return nil, err
		}
		lbl := labelOr(a, "draw diagram ("+count(len(plan.Nodes))+" shapes, "+count(len(plan.Edges))+" connectors)")
		return writeWith(a, plan.Ops, lbl, "nodes", jsonv.FromGo(plan.Nodes), "edges", jsonv.FromGo(plan.Edges))
	})

	add("import_svg", importFields(
		z.Field{Name: "svg", Schema: z.String().Min(1).Max(2_000_000)},
		z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		r, err := core.ImportSVG(a.Str("svg"), importOpts(a))
		if err != nil {
			return nil, err
		}
		return importWrite(r, a, "import SVG")
	})
	add("import_html", importFields(
		z.Field{Name: "html", Schema: z.String().Min(1).Max(2_000_000)},
		z.Field{Name: "computed", Schema: z.Optional(z.Bool())},
	), func(ctx context.Context, a *jsonv.Object) (ToolResult, error) {
		html := a.Str("html")
		if a.Bool("computed") {
			comp, ok := m.shot.(HTMLComputer)
			if m.shot == nil || !ok {
				return nil, errors.New("computed styles need Chromium on this server. Install it with '" + chromiumInstallCommand + "' or set PAPRIKA_CHROMIUM")
			}
			baked, err := comp.ComputedHTML(ctx, html)
			if err != nil {
				return nil, err
			}
			html = baked
		}
		r, err := core.ImportHTML(html, importOpts(a))
		if err != nil {
			return nil, err
		}
		if a.Bool("computed") {
			r.Warnings = append([]string{"styles were read from Chromium computed style and written inline"}, r.Warnings...)
		}
		return importWrite(r, a, "import HTML")
	})
	add("import_image", importFields(
		z.Field{Name: "src", Schema: z.String().Min(1).Max(5_000_000)},
		z.Field{Name: "width", Schema: z.Optional(z.Number().Min(1).Max(100000))},
		z.Field{Name: "fit", Schema: z.Optional(z.Enum("cover", "contain", "fill"))},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		img, base, err := loadImportImage(a.Str("src"))
		if err != nil {
			return nil, err
		}
		w, h := fitWidth(img.width, img.height, a.Num("width"))
		name := base
		if name == "" {
			name = "Image"
		}
		node := jsonv.NewObject("type", "image", "name", name, "src", img.dataURL(), "x", a.Num("x"), "y", a.Num("y"), "width", w, "height", h)
		if a.Has("fit") {
			node.Set("fit", a.Str("fit"))
		}
		parent, _ := a.Get("parentId")
		here, err := docOf(a)
		if err != nil {
			return nil, err
		}
		op := jsonv.NewObject("op", "create", "parentId", parent, "node", node)
		warnings := []any{}
		if p, use := importPlace(here, a); use {
			op.Set("place", p)
		} else if a.Str("place") == "none" && (a.Has("x") || a.Has("y")) {
			if w := pinAbsolute(here, parent, node); w != "" {
				warnings = append(warnings, w)
			}
		}
		res, head, err := applyHere(a, []any{op}, labelOr(a, "import image"))
		if err != nil {
			return nil, err
		}
		if img.animated {
			warnings = append(warnings, "animated "+strings.ToUpper(img.format())+": kept animated (the original bytes are embedded unchanged); render_screenshot shows a single frame")
		}
		for _, w := range core.OverlapWarnings(head.Doc, res.Created) {
			warnings = append(warnings, w)
		}
		out := jsonv.NewObject(
			"created", []any{}, "version", float64(head.Version),
			"width", w, "height", h, "naturalWidth", float64(img.width), "naturalHeight", float64(img.height), "format", img.format(), "animated", img.animated,
			"warnings", warnings,
		)
		stamp(out, head)
		return resultWithRoots(out, head.Doc, res.Created), nil
	})

	add("place_reference", z.Object(
		z.Field{Name: "src", Schema: z.String().Min(1).Max(5_000_000)},
		z.Field{Name: "frameId", Schema: z.String().Min(1)},
		z.Field{Name: "opacity", Schema: z.Default(z.Number().Min(0.05).Max(1), 0.5)},
		optStr("name"),
		workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		img, _, err := loadImportImage(a.Str("src"))
		if err != nil {
			return nil, err
		}
		here, err := docOf(a)
		if err != nil {
			return nil, err
		}
		frameID := a.Str("frameId")
		frame := core.GetNode(here, frameID)
		if frame == nil {
			return nil, fmt.Errorf(`node "%s" does not exist`, frameID)
		}
		if frame.Str("type") != "frame" {
			return nil, fmt.Errorf(`node "%s" is a %s, not a frame`, frameID, frame.Str("type"))
		}
		x, y, w, h := referencePlacement(frame, float64(img.width), float64(img.height))
		name := strings.TrimSpace(a.Str("name"))
		if name == "" {
			name = "Reference"
		}
		node := jsonv.NewObject(
			"type", "image", "name", name, "src", img.dataURL(),
			"x", x, "y", y, "width", w, "height", h,
			"opacity", a.Num("opacity"), "locked", true, "layoutPositioning", "absolute",
		)
		op := jsonv.NewObject("op", "create", "parentId", frameID, "index", float64(0), "node", node)
		res, head, err := applyHere(a, []any{op}, labelOr(a, "place reference"))
		if err != nil {
			return nil, err
		}
		if len(res.Created) == 0 {
			return nil, errors.New("place reference created no node")
		}
		warnings := []any{}
		if img.animated {
			warnings = append(warnings, "animated "+strings.ToUpper(img.format())+": kept animated (the original bytes are embedded unchanged); render_screenshot shows a single frame")
		}
		out := jsonv.NewObject(
			"id", res.Created[0],
			"frameId", frameID,
			"locked", true,
			"opacity", a.Num("opacity"),
			"x", x, "y", y, "width", w, "height", h,
			"warnings", warnings,
			"version", float64(head.Version),
		)
		stamp(out, head)
		return jsonResult(out), nil
	})

	add("resize_image", z.Object(
		z.Field{Name: "nodeId", Schema: z.Optional(z.String().Min(1))},
		z.Field{Name: "src", Schema: z.Optional(z.String().Min(1).Max(5_000_000))},
		z.Field{Name: "preset", Schema: z.Union(
			z.Enum("qhd", "hd", "2k", "4k"),
			z.Object(
				z.Field{Name: "width", Schema: z.Number().Min(1).Max(100000)},
				z.Field{Name: "height", Schema: z.Number().Min(1).Max(100000)},
			),
		)},
		z.Field{Name: "fit", Schema: z.Optional(z.Enum("cover", "contain", "fill"))},
		z.Field{Name: "parentId", Schema: z.Optional(z.Nullable(z.String()))},
		z.Field{Name: "x", Schema: z.Optional(z.Number())},
		z.Field{Name: "y", Schema: z.Optional(z.Number())},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		if !a.Has("nodeId") && !a.Has("src") {
			return nil, errors.New("resize_image requires nodeId or src")
		}
		preset, _ := a.Get("preset")
		tw, th, err := resolveResizeTarget(preset)
		if err != nil {
			return nil, err
		}
		fit := "contain"
		if a.Has("fit") {
			fit = a.Str("fit")
		}
		var info rasterInfo
		var base string
		var nodeID string
		if a.Has("nodeId") {
			nodeID = a.Str("nodeId")
			d, derr := docOf(a)
			if derr != nil {
				return nil, derr
			}
			n := core.GetNode(d, nodeID)
			if n == nil {
				return nil, fmt.Errorf("node %q not found", nodeID)
			}
			if n.Str("type") != "image" {
				return nil, fmt.Errorf("node %q is not an image", nodeID)
			}
			src := n.Str("src")
			if a.Has("src") {
				src = a.Str("src")
			}
			info, base, err = loadImportImage(src)
		} else {
			info, base, err = loadImportImage(a.Str("src"))
		}
		if err != nil {
			return nil, err
		}
		out, err := resizeRaster(info, tw, th, fit)
		if err != nil {
			return nil, err
		}
		warnings := []any{}
		if out.warning != "" {
			warnings = append(warnings, out.warning)
		}
		srcURL := out.dataURL()
		if nodeID != "" {
			props := jsonv.NewObject("src", srcURL, "width", float64(out.width), "height", float64(out.height))
			res, head, err := applyHere(a, []any{jsonv.NewObject("op", "update", "id", nodeID, "props", props)}, labelOr(a, "resize image"))
			if err != nil {
				return nil, err
			}
			body := jsonv.NewObject(
				"id", nodeID, "created", jsonv.FromGo(res.Created), "version", float64(head.Version),
				"width", float64(out.width), "height", float64(out.height),
				"targetWidth", float64(tw), "targetHeight", float64(th),
				"format", out.format, "sourceFormat", out.srcFmt, "fit", fit, "warnings", warnings,
			)
			stamp(body, head)
			return jsonResult(body), nil
		}
		name := base
		if name == "" {
			name = "Image"
		}
		node := jsonv.NewObject("type", "image", "name", name, "src", srcURL, "x", a.Num("x"), "y", a.Num("y"), "width", float64(out.width), "height", float64(out.height), "fit", fit)
		parent, _ := a.Get("parentId")
		res, head, err := applyHere(a, []any{jsonv.NewObject("op", "create", "parentId", parent, "node", node)}, labelOr(a, "resize image"))
		if err != nil {
			return nil, err
		}
		body := jsonv.NewObject(
			"created", jsonv.FromGo(res.Created), "version", float64(head.Version),
			"width", float64(out.width), "height", float64(out.height),
			"targetWidth", float64(tw), "targetHeight", float64(th),
			"format", out.format, "sourceFormat", out.srcFmt, "fit", fit, "warnings", warnings,
		)
		stamp(body, head)
		return jsonResult(body), nil
	})

	add("duplicate_nodes", z.Object(
		z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)},
		z.Field{Name: "offset", Schema: z.Optional(z.Number())},
		z.Field{Name: "parentId", Schema: z.Optional(z.Nullable(z.String()))},
		z.Field{Name: "scale", Schema: z.Optional(z.Number().Min(0.01).Max(100))},
		z.Field{Name: "props", Schema: z.Optional(z.Record(z.String(), z.Unknown()))},
		z.Field{Name: "place", Schema: placeSchema},
		label(), batch(), workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		d, err := docOf(a)
		if err != nil {
			return nil, err
		}
		plan, err := core.DuplicateOps(d, a.Strings("ids"), a)
		if err != nil {
			return nil, err
		}
		r, wrote, err := shapedWrite(a, plan.Ops, labelOr(a, "duplicate "+count(len(plan.Copies))+" node(s)"), "copies", jsonv.FromGo(plan.Copies), "map", plan.Map)
		if err != nil {
			return nil, err
		}
		appendOverlap(r, wrote)
		return r, nil
	})
	m.addPinTools(add)
	return m
}

func pathMoveBox(doc *core.Document, n *core.Node) bool {
	if n.Str("type") == "page" {
		return false
	}
	if n.Str("layoutPositioning") == "absolute" {
		return true
	}
	pid, ok := core.ParentID(n)
	if !ok || pid == "" {
		return true
	}
	p := core.GetNode(doc, pid)
	if p == nil || p.Str("type") != "frame" {
		return true
	}
	layout := p.Obj("layout")
	if layout == nil {
		return true
	}
	mode := layout.Str("mode")
	return mode == "" || mode == "none"
}

func pathAnchors(segs []core.Segment) []any {
	subs := core.PathToSubpaths(segs)
	r := func(v float64) float64 { return jsonv.Round(v*100) / 100 }
	pt := func(p core.Point) *jsonv.Object { return jsonv.NewObject("x", r(p.X), "y", r(p.Y)) }
	out := []any{}
	index := 0
	for si, s := range subs {
		for ai, a := range s.Anchors {
			o := jsonv.NewObject("index", float64(index), "sub", float64(si), "at", float64(ai), "x", r(a.X), "y", r(a.Y))
			if a.In != nil {
				o.Set("in", pt(*a.In))
			}
			if a.Out != nil {
				o.Set("out", pt(*a.Out))
			}
			out = append(out, o)
			index++
		}
	}
	return out
}

func jsString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return jsonv.FormatNumber(t)
	case nil:
		return "null"
	case bool:
		if t {
			return "true"
		}
		return "false"
	}
	return jsonv.Stringify(v, "")
}

// ToolNames lists the registered tools.
func (m *MCP) ToolNames() []string {
	out := make([]string, 0, len(m.tools))
	for k := range m.tools {
		out = append(out, k)
	}
	return out
}

// CallTool runs one tool like the TypeScript SDK's McpServer: validation errors and handler
// errors both come back as isError results.
func (m *MCP) CallTool(ctx context.Context, name string, rawArgs any, present bool) ToolResult {
	t, ok := m.tools[name]
	if !ok {
		return errorResult((&mcpError{codeInvalidParams, fmt.Sprintf("Tool %s not found", name)}).Error())
	}
	args := jsonv.NewObject()
	if t.schema != nil {
		if !present || rawArgs == nil {
			rawArgs = jsonv.NewObject()
		}
		if o, ok := rawArgs.(*jsonv.Object); ok {
			if msg := unknownArgs(name, o, t.schema.Keys()); msg != "" {
				return errorResult((&mcpError{codeInvalidParams, "Input validation error: Invalid arguments for tool " + name + ": " + msg}).Error())
			}
		}
		parsed, err := z.Parse(t.schema, rawArgs)
		if err != nil {
			ze, _ := errors.AsType[*z.Error](err)
			return errorResult((&mcpError{codeInvalidParams, "Input validation error: Invalid arguments for tool " + name + ": " + z.SDKFormat(ze)}).Error())
		}
		args = parsed.(*jsonv.Object)
	}
	res, err := func() (r ToolResult, err error) {
		defer func() {
			if p := recover(); p != nil {
				err = fmt.Errorf("%v", p)
			}
		}()
		return t.handler(ctx, args)
	}()
	// Every tool call that reached its handler reports the agent's presence (canvas cursor).
	var structured *jsonv.Object
	if err == nil && res != nil {
		structured = res.Obj("structuredContent")
	}
	actor := m.actorName()
	m.store.Presence.Report(PresenceKey(m.session, actor), actor, name, PresenceTargets(args, structured, m.store.Doc()))
	if err != nil {
		return errorResult(err.Error())
	}
	return m.withOpenPins(name, res)
}

// argAliases maps a key agents guess to the keys the tools really take, in order of preference.
var argAliases = map[string][]string{
	"id":        {"rootId", "ids"},
	"nodeId":    {"rootId", "id"},
	"node":      {"rootId", "id"},
	"frameId":   {"rootId"},
	"frame":     {"rootId"},
	"root":      {"rootId"},
	"page":      {"pageId", "rootId"},
	"ids":       {"rootIds"},
	"nodeIds":   {"rootIds", "ids"},
	"rootIds":   {"rootId", "ids"},
	"workspace": {"workspaceId"},
}

// unknownArgs names the top-level arguments a tool does not take (they used to be dropped
// silently, so a render_screenshot {id} shot the whole canvas). "" when there are none.
func unknownArgs(tool string, args *jsonv.Object, valid []string) string {
	has := map[string]bool{}
	for _, k := range valid {
		has[k] = true
	}
	var msgs []string
	for _, k := range args.Keys() {
		if has[k] {
			continue
		}
		msg := fmt.Sprintf("unknown argument %q", k)
		hint := ""
		for _, c := range argAliases[k] {
			if has[c] {
				hint = c
				break
			}
		}
		if hint == "" {
			for _, c := range []string{k + "s", strings.TrimSuffix(k, "s")} {
				if c != k && has[c] {
					hint = c
					break
				}
			}
		}
		if hint != "" {
			msg += fmt.Sprintf(" (did you mean %q?)", hint)
		}
		msgs = append(msgs, msg)
	}
	if len(msgs) == 0 {
		return ""
	}
	sorted := append([]string(nil), valid...)
	sort.Strings(sorted)
	return strings.Join(msgs, "; ") + "; valid arguments: " + strings.Join(sorted, ", ")
}

// Handle processes one JSON-RPC message; it returns nil for notifications and responses.
func (m *MCP) Handle(ctx context.Context, msg any) *jsonv.Object {
	o, ok := msg.(*jsonv.Object)
	if !ok {
		return rpcError(nil, codeInvalidRequest, "Invalid Request")
	}
	id, hasID := o.Get("id")
	method, hasMethod := o.Get("method")
	ms, _ := method.(string)
	if !hasMethod {
		return nil // a response from the client: nothing to do
	}
	if !hasID {
		return nil // notification (notifications/initialized, cancelled…)
	}
	params := o.Obj("params")
	switch ms {
	case "initialize":
		if ci := params.Obj("clientInfo"); ci != nil {
			m.client = ci.Str("name")
		}
		requested := params.Str("protocolVersion")
		version := latestProtocolVersion
		for _, v := range supportedProtocolVersions {
			if v == requested {
				version = requested
			}
		}
		res := jsonv.NewObject("protocolVersion", version, "capabilities", mcpContract.Capabilities, "serverInfo", mcpContract.ServerInfo)
		if mcpContract.Instructions != "" {
			res.Set("instructions", mcpContract.Instructions)
		}
		return rpcResult(id, res)
	case "ping":
		return rpcResult(id, jsonv.NewObject())
	case "tools/list":
		return rpcResult(id, jsonv.NewObject("tools", mcpContract.Tools))
	case "tools/call":
		if params == nil || !params.Has("name") {
			return rpcError(id, codeInvalidParams, "Invalid params")
		}
		args, present := params.Get("arguments")
		return rpcResult(id, m.CallTool(ctx, params.Str("name"), args, present))
	}
	return rpcError(id, codeMethodNotFound, "Method not found")
}

func rpcResult(id any, result any) *jsonv.Object {
	return jsonv.NewObject("result", result, "jsonrpc", "2.0", "id", id)
}

func rpcError(id any, code int, msg string) *jsonv.Object {
	return jsonv.NewObject("jsonrpc", "2.0", "id", id, "error", jsonv.NewObject("code", float64(code), "message", msg))
}

// connectorDerivedFields are computed from a connector's from/to; agents that copy node JSON
// from get_nodes bring them back, and create_nodes tolerates that instead of refusing the whole
// call: the fields are dropped and reported as warnings. The primitive create op (canvas,
// apply_ops) keeps refusing them, so nothing derived is ever stored by hand.
var connectorDerivedFields = []string{"x", "y", "width", "height", "d"}

func parentIsTop(doc *core.Document, parent any) bool {
	s, ok := parent.(string)
	if !ok || s == "" {
		return true
	}
	n := core.GetNode(doc, s)
	return n != nil && n.Str("type") == "page"
}

func createPlace(doc *core.Document, parent any, node *jsonv.Object, args *jsonv.Object) (any, bool) {
	if node.Str("type") == "connector" || node.Str("type") == "page" {
		return nil, false
	}
	if args.Has("place") {
		p, _ := args.Get("place")
		if p == "none" {
			return nil, false
		}
		return p, true
	}
	if !parentIsTop(doc, parent) || node.Has("x") || node.Has("y") {
		return nil, false
	}
	return "free", true
}

// pinAbsolute implements "place:none with x/y means exactly there": inside a row/column frame a
// flow child ignores x/y, so the root gets layoutPositioning:"absolute" (unless the agent chose
// one) and the caller reports the returned warning. The caller checks place:"none".
func pinAbsolute(doc *core.Document, parent any, node *jsonv.Object) string {
	if !node.Has("x") && !node.Has("y") || node.Has("layoutPositioning") {
		return ""
	}
	if t := node.Str("type"); t == "connector" || t == "page" {
		return ""
	}
	s, ok := parent.(string)
	if !ok || s == "" {
		return ""
	}
	pn := core.GetNode(doc, s)
	if pn == nil {
		return ""
	}
	mode := pn.Obj("layout").Str("mode")
	if mode != "row" && mode != "column" {
		return ""
	}
	node.Set("layoutPositioning", "absolute")
	name := node.Str("name")
	if name == "" {
		name = node.Str("type")
	}
	return fmt.Sprintf("%q: parent %q has %s layout, so layoutPositioning was set to \"absolute\" to keep x/y (pass layoutPositioning:\"auto\" to join the flow)", name, s, mode)
}

func importPlace(doc *core.Document, args *jsonv.Object) (any, bool) {
	parent, _ := args.Get("parentId")
	if args.Has("place") {
		p, _ := args.Get("place")
		if p == "none" {
			return nil, false
		}
		return p, true
	}
	if args.Has("x") || args.Has("y") || !parentIsTop(doc, parent) {
		return nil, false
	}
	return "free", true
}

func appendOverlap(r ToolResult, doc *core.Document) {
	if r == nil {
		return
	}
	sc := r.Obj("structuredContent")
	if sc == nil {
		return
	}
	ids := sc.Strings("created")
	if len(ids) == 0 {
		ids = sc.Strings("ids")
	}
	extra := core.OverlapWarnings(doc, ids)
	if len(extra) == 0 {
		return
	}
	cur := sc.Arr("warnings")
	for _, w := range extra {
		cur = append(cur, w)
	}
	sc.Set("warnings", cur)
	content := r.Arr("content")
	if len(content) == 0 {
		return
	}
	if o, ok := content[0].(*jsonv.Object); ok && o.Str("type") == "text" {
		o.Set("text", jsonv.Stringify(sc, "  "))
	}
}

func stripConnectorDerived(nodes []any) []string {
	var warnings []string
	var walk func(n any)
	walk = func(n any) {
		o, ok := n.(*jsonv.Object)
		if !ok {
			return
		}
		if o.Str("type") == "connector" {
			var dropped []string
			for _, k := range connectorDerivedFields {
				if o.Has(k) {
					o.Delete(k)
					dropped = append(dropped, k)
				}
			}
			if len(dropped) > 0 {
				id := o.Str("id")
				if id == "" {
					id = "(new)"
				}
				warnings = append(warnings, fmt.Sprintf("connector %q: %s are derived from from/to and were ignored", id, strings.Join(dropped, ", ")))
			}
		}
		for _, c := range o.Arr("children") {
			walk(c)
		}
	}
	for _, n := range nodes {
		walk(n)
	}
	return warnings
}

// workspaceActionError is the actionable text an agent reads when a workspace call cannot go through.
func workspaceActionError(id string, err error) error {
	switch {
	case errors.Is(err, ErrNoWorkspace):
		return fmt.Errorf(`workspace "%s" does not exist (see list_workspaces)`, id)
	case errors.Is(err, ErrLastWorkspace):
		return fmt.Errorf(`workspace "%s" is the only one and cannot be deleted`, id)
	case errors.Is(err, ErrArchiveOnly):
		return fmt.Errorf(`workspace "%s" is the only one and cannot be archived`, id)
	}
	return err
}

// exportImage renders raster formats with the same Chromium path as render_screenshot, so an
// export matches what the canvas and the screenshot show. Without Chromium (or if it fails) it
// falls back to the built-in rasterizer and says so in the warnings. PDF always uses the built-in writer.
func (m *MCP) exportImage(ctx context.Context, d *core.Document, rootID, format string, scale float64) (export.Result, error) {
	format = strings.ToLower(strings.TrimSpace(format))
	if scale <= 0 {
		scale = 1
	}
	if m.shot == nil || format == export.FormatPDF || scale < 0.1 || scale > 4 {
		return export.Export(d, rootID, format, scale)
	}
	png, _, _, err := m.shot.ScreenshotMode(ctx, d, rootID, scale, "")
	if err == nil {
		var out export.Result
		if out, err = export.FromPNG(png, format); err == nil {
			out.Warnings = []string{}
			return out, nil
		}
	}
	out, ferr := export.Export(d, rootID, format, scale)
	if ferr != nil {
		return out, ferr
	}
	out.Warnings = append([]string{"Chromium unavailable (" + err.Error() + "): rendered with the built-in rasterizer, which can differ from render_screenshot in glyphs and strokes"}, out.Warnings...)
	return out, nil
}
