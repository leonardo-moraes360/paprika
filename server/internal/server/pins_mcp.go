package server

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
	z "github.com/leonardo-moraes360/paprika/server/internal/zod"
)

var pinTools = map[string]bool{"list_pins": true, "claim_pin": true, "reply_pin": true, "resolve_pin": true, "update_pin": true, "wait_for_pins": true}

const MaxPinWait = 60 * time.Second

func pinMCPError(id string, err error) error {
	switch {
	case errors.Is(err, ErrNoPin):
		return fmt.Errorf(`pin "%s" does not exist: call list_pins for the current ids`, id)
	case errors.Is(err, ErrPinResolved):
		return fmt.Errorf(`pin "%s" is already resolved: the human reopens it if more is needed`, id)
	case errors.Is(err, ErrPinClaimed):
		return fmt.Errorf(`pin "%s": %v; leave it to that agent or pick another pin`, id, err)
	}
	return err
}

func pinsResult(pins []Pin, extra ...any) ToolResult {
	out := jsonv.NewObject("pins", jsonv.FromGo(pins))
	for i := 0; i+1 < len(extra); i += 2 {
		out.Set(extra[i].(string), extra[i+1])
	}
	return jsonResult(out)
}

func (m *MCP) addPinTools(add func(name string, schema *z.ObjectSchema, h func(ctx context.Context, args *jsonv.Object) (ToolResult, error))) {
	store := m.store
	add("list_pins", z.Object(
		z.Field{Name: "status", Schema: z.Default(z.Enum(PinOpen, PinClaimed, PinResolved, "all"), PinOpen)},
		optStr("pageId"),
		workspaceID(),
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		pins, err := store.ListPins(PinFilter{WorkspaceID: a.Str("workspaceId"), Status: a.Str("status"), PageID: a.Str("pageId")})
		if err != nil {
			if errors.Is(err, ErrNoWorkspace) {
				return nil, store.WorkspaceChoiceError(a.Str("workspaceId"))
			}
			return nil, err
		}
		return pinsResult(pins, "rev", float64(store.PinsRev())), nil
	})
	add("claim_pin", z.Object(
		z.Field{Name: "id", Schema: z.String().Min(1)},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		pin, err := store.ClaimPin(a.Str("id"), m.actorName())
		if err != nil {
			return nil, pinMCPError(a.Str("id"), err)
		}
		return jsonResult(jsonv.NewObject("pin", jsonv.FromGo(pin))), nil
	})
	add("reply_pin", z.Object(
		z.Field{Name: "id", Schema: z.String().Min(1)},
		z.Field{Name: "text", Schema: z.String().Min(1).Max(MaxPinReply)},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		pin, err := store.ReplyPin(a.Str("id"), m.actorName(), a.Str("text"))
		if err != nil {
			return nil, pinMCPError(a.Str("id"), err)
		}
		return jsonResult(jsonv.NewObject("pin", jsonv.FromGo(pin))), nil
	})
	add("resolve_pin", z.Object(
		z.Field{Name: "id", Schema: z.String().Min(1)},
		z.Field{Name: "reply", Schema: z.String().Min(1).Max(MaxPinReply)},
		z.Field{Name: "nodeId", Schema: z.Optional(z.String().Min(1))},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		pin, err := store.ResolvePinAt(a.Str("id"), m.actorName(), a.Str("reply"), a.Str("nodeId"))
		if err != nil {
			return nil, pinMCPError(a.Str("id"), err)
		}
		return jsonResult(jsonv.NewObject("pin", jsonv.FromGo(pin))), nil
	})
	add("update_pin", z.Object(
		z.Field{Name: "id", Schema: z.String().Min(1)},
		z.Field{Name: "nodeId", Schema: z.String().Min(1)},
	), func(_ context.Context, a *jsonv.Object) (ToolResult, error) {
		pin, err := store.ReanchorPin(a.Str("id"), m.actorName(), a.Str("nodeId"))
		if err != nil {
			return nil, pinMCPError(a.Str("id"), err)
		}
		return jsonResult(jsonv.NewObject("pin", jsonv.FromGo(pin))), nil
	})
	add("wait_for_pins", z.Object(
		z.Field{Name: "timeoutMs", Schema: z.Default(z.Int().Min(0).Max(float64(MaxPinWait/time.Millisecond)), 30000.0)},
		z.Field{Name: "since", Schema: z.Default(z.Int().Min(0), 0.0)},
		workspaceID(),
	), func(ctx context.Context, a *jsonv.Object) (ToolResult, error) {
		pins, rev, err := store.WaitForPins(ctx, a.Str("workspaceId"), int64(a.Num("since")), time.Duration(a.Num("timeoutMs"))*time.Millisecond)
		if err != nil {
			if errors.Is(err, ErrNoWorkspace) {
				return nil, store.WorkspaceChoiceError(a.Str("workspaceId"))
			}
			return nil, err
		}
		return pinsResult(pins, "rev", float64(rev), "timedOut", len(pins) == 0), nil
	})
}

func (m *MCP) withOpenPins(name string, res ToolResult) ToolResult {
	if pinTools[name] || res == nil {
		return res
	}
	structured := res.Obj("structuredContent")
	if structured == nil || !structured.Has("version") {
		return res
	}
	n := m.store.CountOpenPins(structured.Str("workspaceId"))
	if n == 0 {
		return res
	}
	structured.Set("openPins", float64(n))
	content := res.Arr("content")
	content = append(content, jsonv.NewObject("type", "text", "text",
		fmt.Sprintf("%d open pin(s) from the human in this workspace: call list_pins, then claim_pin and resolve_pin.", n)))
	res.Set("content", content)
	return res
}
