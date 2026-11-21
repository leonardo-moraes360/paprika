package server

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

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

func jsonResult(v any) ToolResult { return textResult(jsonv.Stringify(jsonv.FromGo(v), "  ")) }

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
	actor string
	tools map[string]tool
	shot  Screenshotter
}

// Screenshotter renders HTML to PNG.
type Screenshotter interface {
	Screenshot(ctx context.Context, doc *core.Document, rootID string, scale float64) (png []byte, width, height int, err error)
}

func optStr(name string) z.Field { return z.Field{Name: name, Schema: z.Optional(z.String())} }

func label() z.Field { return z.Field{Name: "label", Schema: z.Optional(z.String().Max(200))} }

// NewMCP builds the tool set for an actor ("agent:claude", "agent:stdio"…).
func NewMCP(store *Store, actor string, shot Screenshotter) *MCP {
	if actor == "" {
		actor = "agent"
	}
	m := &MCP{store: store, actor: actor, tools: map[string]tool{}, shot: shot}
	add := func(name string, schema *z.ObjectSchema, h func(ctx context.Context, args *jsonv.Object) (ToolResult, error)) {
		m.tools[name] = tool{name, schema, h}
	}
	write := func(ops []any, lbl string) (ToolResult, error) {
		r, err := store.Apply(ops, actor, lbl)
		if err != nil {
			return nil, err
		}
		return jsonResult(jsonv.NewObject("created", jsonv.FromGo(r.Created), "version", float64(store.Version()))), nil
	}
	labelOr := func(args *jsonv.Object, def string) string {
		if args.Has("label") {
			return args.Str("label")
		}
		return def
	}
	count := func(n int) string { return jsonv.FormatNumber(float64(n)) }

	add("get_design_guide", nil, func(context.Context, *jsonv.Object) (ToolResult, error) { return textResult(DesignGuide), nil })

	add("get_document_outline", z.Object(
		optStr("rootId"),
		z.Field{Name: "depth", Schema: z.Optional(z.Int().Min(0).Max(50))},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		d, version, _, _ := store.Snapshot()
		rootID := a.Str("rootId")
		if rootID != "" && core.GetNode(d, rootID) == nil {
			return nil, fmt.Errorf(`nó "%s" não existe`, rootID)
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
			tokens = "(nenhum)"
		}
		return textResult(fmt.Sprintf("documento \"%s\" v%d · %s nós\ntokens: %s\n\n%s", d.Str("name"), version,
			count(core.Nodes(d).Len()), tokens, core.Outline(d, rootID, depth))), nil
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
				return nil, fmt.Errorf("nós inexistentes: %s", strings.Join(missing, ", "))
			}
			return jsonResult(out), nil
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
			return textResult("(nada encontrado)"), nil
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
				return nil, fmt.Errorf(`nó "%s" não existe`, id)
			}
			if t := n.Str("type"); t != "path" {
				return nil, fmt.Errorf(`nó "%s" é %s, não path`, id, t)
			}
			src, ox, oy = n.Str("d"), n.Num("x"), n.Num("y")
		}
		if src == "" {
			return nil, errors.New("passe d ou id")
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
		label(),
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
		return write(ops, labelOr(a, "criar "+count(len(nodes))+" nó(s)"))
	})

	add("update_nodes", z.Object(
		z.Field{Name: "updates", Schema: z.Array(z.Object(
			z.Field{Name: "id", Schema: z.String()},
			z.Field{Name: "props", Schema: z.Record(z.String(), z.Unknown())},
		)).Min(1).Max(500)},
		label(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		ups := a.Arr("updates")
		ops := make([]any, len(ups))
		for i, u := range ups {
			uo := u.(*jsonv.Object)
			props, _ := uo.Get("props")
			ops[i] = jsonv.NewObject("op", "update", "id", uo.Str("id"), "props", props)
		}
		return write(ops, labelOr(a, "alterar "+count(len(ups))+" nó(s)"))
	})

	add("delete_nodes", z.Object(z.Field{Name: "ids", Schema: z.Array(z.String()).Min(1).Max(500)}, label()),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			ids := a.Strings("ids")
			ops := make([]any, len(ids))
			for i, id := range ids {
				ops[i] = jsonv.NewObject("op", "delete", "id", id)
			}
			return write(ops, labelOr(a, "apagar "+count(len(ids))+" nó(s)"))
		})

	add("move_nodes", z.Object(
		z.Field{Name: "moves", Schema: z.Array(z.Object(
			z.Field{Name: "id", Schema: z.String()},
			z.Field{Name: "parentId", Schema: z.Nullable(z.String())},
			z.Field{Name: "index", Schema: z.Optional(z.Int().Min(0))},
		)).Min(1)},
		label(),
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
		return write(ops, labelOr(a, "mover "+count(len(moves))+" nó(s)"))
	})

	add("apply_ops", z.Object(z.Field{Name: "ops", Schema: z.Array(core.OpSchema).Min(1).Max(1000)}, label()),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			ops := a.Arr("ops")
			return write(ops, labelOr(a, "transação de "+count(len(ops))+" op(s)"))
		})

	add("set_tokens", z.Object(
		z.Field{Name: "tokens", Schema: z.Record(z.String(), z.Union(z.String(), z.Number(), z.Null()))},
		label(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		tokens, _ := a.Get("tokens")
		return write([]any{jsonv.NewObject("op", "set_tokens", "tokens", tokens)}, labelOr(a, "tokens"))
	})

	stepResult := func(key string, ok bool) ToolResult {
		_, version, cu, cr := store.Snapshot()
		return jsonResult(jsonv.NewObject(key, ok, "version", float64(version), "canUndo", cu, "canRedo", cr))
	}
	add("undo", nil, func(context.Context, *jsonv.Object) (ToolResult, error) {
		ok, err := store.Undo(actor)
		if err != nil {
			return nil, err
		}
		return stepResult("undone", ok), nil
	})
	add("redo", nil, func(context.Context, *jsonv.Object) (ToolResult, error) {
		ok, err := store.Redo(actor)
		if err != nil {
			return nil, err
		}
		return stepResult("redone", ok), nil
	})

	add("get_history", z.Object(z.Field{Name: "limit", Schema: z.Default(z.Int().Min(1).Max(200), 20.0)}),
		func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
			return jsonResult(store.RecentHistory(int(a.Num("limit")))), nil
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
			return nil, errors.New("screenshot indisponível neste servidor")
		}
		png, w, h, err := m.shot.Screenshot(ctx, store.Doc(), a.Str("rootId"), a.Num("scale"))
		if err != nil {
			return nil, err
		}
		return jsonv.NewObject("content", []any{
			jsonv.NewObject("type", "image", "data", base64.StdEncoding.EncodeToString(png), "mimeType", "image/png"),
			jsonv.NewObject("type", "text", "text", fmt.Sprintf("%d×%dpx", w, h)),
		}), nil
	})

	add("export_code", z.Object(
		z.Field{Name: "rootId", Schema: z.String()},
		z.Field{Name: "format", Schema: z.Default(z.Enum("html", "react"), "react")},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		d := store.Doc()
		if a.Str("format") == "html" {
			html, _, err := core.RenderHTML(d, core.RenderOptions{RootID: a.Str("rootId")})
			if err != nil {
				return nil, err
			}
			return textResult(html), nil
		}
		code, err := core.ExportReact(d, a.Str("rootId"))
		if err != nil {
			return nil, err
		}
		return textResult(code), nil
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
