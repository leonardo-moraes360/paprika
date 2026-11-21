package server

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/leonardo-moraes360/paprika/server-go/contract"
	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
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

// Screenshotter renders HTML in a browser: PNG screenshots and the measured SVG export.
type Screenshotter interface {
	Screenshot(ctx context.Context, doc *core.Document, rootID string, scale float64) (png []byte, width, height int, err error)
	ExportSVG(ctx context.Context, doc *core.Document, rootID string) (core.SVGResult, error)
}

func optStr(name string) z.Field { return z.Field{Name: name, Schema: z.Optional(z.String())} }

func label() z.Field { return z.Field{Name: "label", Schema: z.Optional(z.String().Max(200))} }

func batch() z.Field { return z.Field{Name: "batch", Schema: z.Optional(z.String().Min(1).Max(200))} }

// ActorFromClient turns a clientInfo name into "agent:<name>" (same filter as the TS server); "" if nothing is left.
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
	// writeWith answers extra fields first, then created and version (same key order as the TS server).
	// The last two extra values may be "batch", name (taken from the args by the callers).
	writeBatch := func(ops []any, lbl, bt string, extra ...any) (ToolResult, error) {
		r, err := store.ApplyBatch(ops, m.actorName(), lbl, bt)
		if err != nil {
			return nil, err
		}
		out := jsonv.NewObject(extra...)
		out.Set("created", jsonv.FromGo(r.Created))
		out.Set("version", float64(store.Version()))
		return jsonResult(out), nil
	}
	// argsBatch: the batch argument of the call being served (set by CallTool before the handler).
	writeWith := func(a *jsonv.Object, ops []any, lbl string, extra ...any) (ToolResult, error) {
		return writeBatch(ops, lbl, a.Str("batch"), extra...)
	}
	write := func(a *jsonv.Object, ops []any, lbl string) (ToolResult, error) { return writeWith(a, ops, lbl) }
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
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		d, version, _, _ := store.Snapshot()
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
			toks = append(toks, "$"+k+"="+jsString(v))
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
		return textResult(fmt.Sprintf("document \"%s\" v%d · %s nodes\ntokens: %s\n%s\n%s", d.Str("name"), version,
			count(core.Nodes(d).Len()), tokens, modes, core.Outline(d, rootID, depth))), nil
	})

	add("get_nodes", z.Object(z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(200)}),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			d := store.Doc()
			ids := a.Strings("ids")
			var missing []string
			out := make([]any, 0, len(ids))
			for _, id := range ids {
				n := core.GetNode(d, id)
				if n == nil {
					missing = append(missing, id)
				}
				out = append(out, n)
			}
			if len(missing) > 0 {
				return nil, fmt.Errorf("nodes do not exist: %s", strings.Join(missing, ", "))
			}
			return jsonShown(jsonv.NewObject("nodes", out), out), nil
		})

	add("find_nodes", z.Object(
		z.Field{Name: "type", Schema: z.Optional(core.NodeTypeSchema)},
		optStr("name"), optStr("text"), optStr("within"),
		z.Field{Name: "limit", Schema: z.Default(z.Int().Min(1).Max(500), 50.0)},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		d := store.Doc()
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

	add("path_info", z.Object(
		z.Field{Name: "d", Schema: z.Optional(z.String().Max(200_000))},
		optStr("id"),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		src := a.Str("d")
		ox, oy := 0.0, 0.0
		id := a.Str("id")
		if id != "" {
			n := core.GetNode(store.Doc(), id)
			if n == nil {
				return nil, fmt.Errorf(`node "%s" does not exist`, id)
			}
			if t := n.Str("type"); t != "path" {
				return nil, fmt.Errorf(`node "%s" is %s, not a path`, id, t)
			}
			src, ox, oy = n.Str("d"), n.Num("x"), n.Num("y")
		}
		if src == "" {
			return nil, errors.New("pass d or id")
		}
		segs, err := core.ParsePath(src)
		if err != nil {
			return nil, err
		}
		b := core.PathBounds(segs)
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
		)
		if id != "" {
			out.Set("canvasBounds", jsonv.NewObject("x", r(ox+b.X), "y", r(oy+b.Y), "width", r(b.Width), "height", r(b.Height)))
		}
		out.Set("normalized", core.SerializePath(segs))
		return jsonResult(out), nil
	})

	add("create_nodes", z.Object(
		z.Field{Name: "parentId", Schema: z.Optional(z.Nullable(z.String()))},
		z.Field{Name: "index", Schema: z.Optional(z.Int().Min(0))},
		z.Field{Name: "nodes", Schema: z.Array(core.NodeInputSchema).Min(1).Max(500)},
		label(), batch(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		nodes := a.Arr("nodes")
		parentID, _ := a.Get("parentId")
		ops := make([]any, len(nodes))
		for i, n := range nodes {
			op := jsonv.NewObject("op", "create", "node", n, "parentId", parentID)
			if a.Has("index") {
				op.Set("index", a.Num("index")+float64(i))
			}
			ops[i] = op
		}
		return write(a, ops, labelOr(a, "create "+count(len(nodes))+" node(s)"))
	})

	add("update_nodes", z.Object(
		z.Field{Name: "updates", Schema: z.Array(z.Object(
			z.Field{Name: "id", Schema: z.String()},
			z.Field{Name: "props", Schema: z.Record(z.String(), z.Unknown())},
		)).Min(1).Max(500)},
		label(), batch(),
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

	add("delete_nodes", z.Object(z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)}, label(), batch()),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			ids := a.Strings("ids")
			ops := make([]any, len(ids))
			for i, id := range ids {
				ops[i] = jsonv.NewObject("op", "delete", "id", id)
			}
			return write(a, ops, labelOr(a, "delete "+count(len(ids))+" node(s)"))
		})

	add("move_nodes", z.Object(
		z.Field{Name: "moves", Schema: z.Array(z.Object(
			z.Field{Name: "id", Schema: z.String()},
			z.Field{Name: "parentId", Schema: z.Nullable(z.String())},
			z.Field{Name: "index", Schema: z.Optional(z.Int().Min(0))},
		)).Min(1)},
		label(), batch(),
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

	add("group_nodes", z.Object(
		z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)},
		z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
		optStr("id"),
		label(), batch(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		ids := a.Strings("ids")
		id := a.Str("id")
		if !a.Has("id") {
			id = core.NewID()
		}
		op := jsonv.NewObject("op", "group", "ids", a.Arr("ids"), "id", id)
		if a.Has("name") {
			op.Set("name", a.Str("name"))
		}
		return writeWith(a, []any{op}, labelOr(a, "group "+count(len(ids))+" node(s)"), "group", id)
	})

	add("ungroup_nodes", z.Object(z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)}, label(), batch()),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			ids := a.Strings("ids")
			_, released, err := core.UngroupOps(store.Doc(), ids) // validates and tells which children come back
			if err != nil {
				return nil, err
			}
			op := jsonv.NewObject("op", "ungroup", "ids", a.Arr("ids"))
			return writeWith(a, []any{op}, labelOr(a, "ungroup "+count(len(ids))+" group(s)"), "released", jsonv.FromGo(released))
		})

	add("create_page", z.Object(
		z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
		optStr("id"),
		label(), batch(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		id := a.Str("id")
		if !a.Has("id") {
			id = core.NewID()
		}
		op := jsonv.NewObject("op", "add_page", "id", id)
		if a.Has("name") {
			op.Set("name", a.Str("name"))
		}
		return writeWith(a, []any{op}, labelOr(a, "create page"), "page", id)
	})

	add("create_component", z.Object(z.Field{Name: "id", Schema: z.String()}, label(), batch()),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			id := a.Str("id")
			op := jsonv.NewObject("op", "update", "id", id, "props", jsonv.NewObject("component", true))
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
		optStr("id"),
		label(), batch(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		compID := a.Str("componentId")
		comp := core.GetNode(store.Doc(), compID)
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
		var parent any
		if v, ok := a.Get("parentId"); ok {
			parent = v
		} else if comp != nil {
			parent, _ = comp.Get("parentId")
		}
		op := jsonv.NewObject("op", "create", "parentId", parent, "node", node)
		copies := jsonv.NewObject()
		var walk func(nid string)
		walk = func(nid string) {
			n := core.GetNode(store.Doc(), nid)
			if n == nil || !core.IsContainer(n.Str("type")) {
				return
			}
			for _, c := range n.Strings("children") {
				copies.Set(c, core.CopyID(iid, c))
				walk(c)
			}
		}
		walk(compID)
		return writeWith(a, []any{op}, labelOr(a, "create instance"), "instance", iid, "copies", copies)
	})

	add("detach_instance", z.Object(z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)}, label(), batch()),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			ids := a.Strings("ids")
			op := jsonv.NewObject("op", "detach", "ids", a.Arr("ids"))
			return writeWith(a, []any{op}, labelOr(a, "detach "+count(len(ids))+" instance(s)"), "detached", a.Arr("ids"))
		})

	add("apply_ops", z.Object(z.Field{Name: "ops", Schema: z.Array(core.OpSchema).Min(1).Max(1000)}, label(), batch()),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			ops := a.Arr("ops")
			return write(a, ops, labelOr(a, "transaction of "+count(len(ops))+" op(s)"))
		})

	add("set_tokens", z.Object(
		z.Field{Name: "tokens", Schema: z.Record(z.String(), z.Union(z.String(), z.Number(), z.Null()))},
		optStr("mode"),
		label(), batch(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		tokens, _ := a.Get("tokens")
		op := jsonv.NewObject("op", "set_tokens", "tokens", tokens)
		if m := a.Str("mode"); m != "" {
			op.Set("mode", m)
		}
		return write(a, []any{op}, labelOr(a, "tokens"))
	})

	stepResult := func(key string, ok bool) ToolResult {
		_, version, cu, cr := store.Snapshot()
		return jsonResult(jsonv.NewObject(key, ok, "version", float64(version), "canUndo", cu, "canRedo", cr))
	}
	add("undo", nil, func(context.Context, *jsonv.Object) (ToolResult, error) {
		ok, err := store.Undo(m.actorName())
		if err != nil {
			return nil, err
		}
		return stepResult("undone", ok), nil
	})
	add("redo", nil, func(context.Context, *jsonv.Object) (ToolResult, error) {
		ok, err := store.Redo(m.actorName())
		if err != nil {
			return nil, err
		}
		return stepResult("redone", ok), nil
	})

	add("get_history", z.Object(z.Field{Name: "limit", Schema: z.Default(z.Int().Min(1).Max(200), 20.0)}),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			entries := jsonv.FromGo(store.RecentHistory(int(a.Num("limit"))))
			return jsonShown(jsonv.NewObject("entries", entries), entries), nil
		})

	add("list_workspaces", nil, func(context.Context, *jsonv.Object) (ToolResult, error) {
		ws, err := store.ListWorkspaces()
		if err != nil {
			return nil, err
		}
		return jsonResult(jsonv.NewObject("active", store.DocID(), "workspaces", jsonv.FromGo(ws))), nil
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
			info, err := store.CreateWorkspace(a.Str("name"))
			if err != nil {
				return nil, err
			}
			return jsonResult(jsonv.NewObject("workspace", jsonv.FromGo(info))), nil
		})

	add("lint_design", z.Object(optStr("rootId")), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		issues := core.LintDocument(store.Doc(), a.Str("rootId"))
		counts := map[string]int{"error": 0, "warning": 0, "info": 0}
		for _, i := range issues {
			counts[i.Severity]++
		}
		return jsonResult(jsonv.NewObject(
			"ok", counts["error"] == 0,
			"counts", jsonv.NewObject("error", float64(counts["error"]), "warning", float64(counts["warning"]), "info", float64(counts["info"])),
			"issues", jsonv.FromGo(issues),
		)), nil
	})

	add("render_screenshot", z.Object(
		optStr("rootId"),
		z.Field{Name: "scale", Schema: z.Default(z.Number().Min(0.1).Max(4), 1.0)},
	), func(ctx context.Context, a *jsonv.Object) (ToolResult, error) {
		if m.shot == nil {
			return nil, errors.New("screenshot unavailable on this server")
		}
		png, w, h, err := m.shot.Screenshot(ctx, store.Doc(), a.Str("rootId"), a.Num("scale"))
		if err != nil {
			return nil, err
		}
		return jsonv.NewObject("content", []any{
			jsonv.NewObject("type", "image", "data", base64.StdEncoding.EncodeToString(png), "mimeType", "image/png"),
			jsonv.NewObject("type", "text", "text", fmt.Sprintf("%d×%dpx", w, h)),
		}, "structuredContent", jsonv.NewObject("width", float64(w), "height", float64(h))), nil
	})

	add("export_code", z.Object(
		z.Field{Name: "rootId", Schema: z.String()},
		z.Field{Name: "format", Schema: z.Default(z.Enum("html", "react", "svg"), "react")},
		z.Field{Name: "cssVariables", Schema: z.Default(z.Bool(), false)},
	), func(ctx context.Context, a *jsonv.Object) (ToolResult, error) {
		d := store.Doc()
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
		}
		if m.shot == nil {
			return nil, errors.New("SVG export unavailable on this server")
		}
		r, err := m.shot.ExportSVG(ctx, d, a.Str("rootId"))
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
			label(), batch(),
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
		ops := make([]any, len(r.Nodes))
		for i, n := range r.Nodes {
			ops[i] = jsonv.NewObject("op", "create", "parentId", parent, "node", n)
		}
		res, err := store.ApplyBatch(ops, m.actorName(), labelOr(a, def), a.Str("batch"))
		if err != nil {
			return nil, err
		}
		ws := make([]any, len(r.Warnings))
		for i, w := range r.Warnings {
			ws[i] = w
		}
		return jsonResult(jsonv.NewObject("created", jsonv.FromGo(res.Created), "version", float64(store.Version()), "warnings", ws)), nil
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
		z.Field{Name: "nodes", Schema: z.Default(z.Array(z.Object(
			z.Field{Name: "id", Schema: z.String().Regex(`^[A-Za-z0-9_-]{1,64}$`, `/^[A-Za-z0-9_-]{1,64}$/`, "id must be [A-Za-z0-9_-]{1,64}")},
		).Catchall(z.Unknown())).Max(500), []any{})},
		z.Field{Name: "edges", Schema: z.Default(z.Array(z.Object(
			z.Field{Name: "from", Schema: z.String()},
			z.Field{Name: "to", Schema: z.String()},
			optStr("id"),
			z.Field{Name: "fromSide", Schema: z.Optional(core.ConnectorSideSchema)},
			z.Field{Name: "toSide", Schema: z.Optional(core.ConnectorSideSchema)},
			z.Field{Name: "route", Schema: z.Optional(z.Enum("straight", "elbow"))},
			z.Field{Name: "startArrow", Schema: z.Optional(z.Enum("none", "arrow"))},
			z.Field{Name: "endArrow", Schema: z.Optional(z.Enum("none", "arrow"))},
			z.Field{Name: "dashed", Schema: z.Optional(z.Bool())},
			z.Field{Name: "stroke", Schema: z.Optional(core.StrokeSchema)},
			z.Field{Name: "name", Schema: z.Optional(z.String().Max(200))},
		)).Max(1000), []any{})},
		label(), batch(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		plan, err := core.DiagramOps(store.Doc(), a)
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
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		r, err := core.ImportHTML(a.Str("html"), importOpts(a))
		if err != nil {
			return nil, err
		}
		return importWrite(r, a, "import HTML")
	})
	return m
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
		parsed, err := z.Parse(t.schema, rawArgs)
		if err != nil {
			var ze *z.Error
			errors.As(err, &ze)
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
	return res
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
