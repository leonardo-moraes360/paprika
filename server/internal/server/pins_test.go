package server

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func structuredOf(t *testing.T, r ToolResult) *jsonv.Object {
	t.Helper()
	if r.Bool("isError") {
		t.Fatalf("tool error: %s", callTextJoin(r))
	}
	o := r.Obj("structuredContent")
	if o == nil {
		t.Fatalf("no structuredContent: %s", callTextJoin(r))
	}
	return o
}

func TestPinsLifecycleOverMCP(t *testing.T) {
	s, _ := openTemp(t)
	human, err := s.CreatePin("", NewPin{NodeID: "missing", Region: PinRegion{X: 10, Y: 20, Width: 100, Height: 40}, Text: "  Deixe este botão maior  "}, "user")
	if err != nil {
		t.Fatal(err)
	}
	if human.N != 1 || human.Status != PinOpen || human.Text != "Deixe este botão maior" || !human.NodeMissing {
		t.Fatalf("created pin: %+v", human)
	}
	area, err := s.CreatePin("", NewPin{Region: PinRegion{X: 0, Y: 0, Width: 300, Height: 90}, Text: "Troque o cabeçalho"}, "user")
	if err != nil || area.N != 2 || area.NodeID != "" {
		t.Fatalf("area pin: %+v %v", area, err)
	}

	a := NewMCP(s, "agent:a", nil)
	b := NewMCP(s, "agent:b", nil)
	ctx := context.Background()

	list := structuredOf(t, a.CallTool(ctx, "list_pins", jsonv.NewObject(), true))
	if n := len(list.Arr("pins")); n != 2 {
		t.Fatalf("list_pins: %d pins", n)
	}

	claimed := structuredOf(t, a.CallTool(ctx, "claim_pin", jsonv.NewObject("id", human.ID), true)).Obj("pin")
	if claimed.Str("status") != PinClaimed || claimed.Str("claimedBy") != "agent:a" {
		t.Fatalf("claim: %s", jsonv.Stringify(claimed, ""))
	}
	structuredOf(t, a.CallTool(ctx, "claim_pin", jsonv.NewObject("id", human.ID), true))
	if txt, isErr := callText(t, b, "claim_pin", jsonv.NewObject("id", human.ID)); !isErr || !strings.Contains(txt, "agent:a") {
		t.Fatalf("second claim: %v %s", isErr, txt)
	}
	if txt, isErr := callText(t, b, "resolve_pin", jsonv.NewObject("id", human.ID, "reply", "feito")); !isErr || !strings.Contains(txt, "claimed by another agent") {
		t.Fatalf("resolve by another: %v %s", isErr, txt)
	}
	resolved := structuredOf(t, a.CallTool(ctx, "resolve_pin", jsonv.NewObject("id", human.ID, "reply", "Altura 44, cor de destaque"), true)).Obj("pin")
	if resolved.Str("status") != PinResolved || resolved.Str("reply") != "Altura 44, cor de destaque" || resolved.Str("resolvedBy") != "agent:a" {
		t.Fatalf("resolve: %s", jsonv.Stringify(resolved, ""))
	}
	replies := resolved.Arr("replies")
	if len(replies) != 1 || replies[0].(*jsonv.Object).Str("text") != "Altura 44, cor de destaque" || replies[0].(*jsonv.Object).Str("author") != "agent:a" {
		t.Fatalf("resolve reply thread: %s", jsonv.Stringify(resolved, ""))
	}
	followed := structuredOf(t, b.CallTool(ctx, "reply_pin", jsonv.NewObject("id", human.ID, "text", "E o peso da fonte?"), true)).Obj("pin")
	if followed.Str("status") != PinResolved || len(followed.Arr("replies")) != 2 {
		t.Fatalf("reply_pin: %s", jsonv.Stringify(followed, ""))
	}
	if txt, isErr := callText(t, a, "resolve_pin", jsonv.NewObject("id", human.ID, "reply", "de novo")); !isErr || !strings.Contains(txt, "already resolved") {
		t.Fatalf("resolve twice: %v %s", isErr, txt)
	}
	if txt, isErr := callText(t, a, "claim_pin", jsonv.NewObject("id", "nope")); !isErr || !strings.Contains(txt, "does not exist") {
		t.Fatalf("missing pin: %v %s", isErr, txt)
	}

	open := structuredOf(t, a.CallTool(ctx, "list_pins", jsonv.NewObject(), true)).Arr("pins")
	if len(open) != 1 || open[0].(*jsonv.Object).Str("id") != area.ID {
		t.Fatalf("open after resolve: %d", len(open))
	}
	done := structuredOf(t, a.CallTool(ctx, "list_pins", jsonv.NewObject("status", "resolved"), true)).Arr("pins")
	if len(done) != 1 {
		t.Fatalf("resolved list: %d", len(done))
	}

	if p, err := s.ReopenPin(human.ID); err != nil || p.Status != PinOpen || p.ClaimedBy != "" || p.Reply == "" {
		t.Fatalf("reopen: %+v %v", p, err)
	}
	if _, err := s.DeletePin(area.ID); err != nil {
		t.Fatal(err)
	}
	all := structuredOf(t, a.CallTool(ctx, "list_pins", jsonv.NewObject("status", "all"), true)).Arr("pins")
	if len(all) != 1 {
		t.Fatalf("all after delete: %d", len(all))
	}
}

func TestPinsInput(t *testing.T) {
	s, _ := openTemp(t)
	if _, err := s.CreatePin("", NewPin{Text: "   "}, "user"); err == nil {
		t.Fatal("blank text accepted")
	}
	if _, err := s.CreatePin("nope", NewPin{Text: "x"}, "user"); err == nil {
		t.Fatal("unknown workspace accepted")
	}
	if _, err := s.CreatePin("", NewPin{Text: strings.Repeat("a", MaxPinText+1)}, "user"); err == nil {
		t.Fatal("long text accepted")
	}
	p, _ := s.CreatePin("", NewPin{Text: "x"}, "user")
	if _, err := s.ResolvePin(p.ID, "agent:a", " "); err == nil {
		t.Fatal("blank reply accepted")
	}
	m := NewMCP(s, "agent:a", nil)
	if txt, isErr := callText(t, m, "list_pins", jsonv.NewObject("status", "bogus")); !isErr {
		t.Fatalf("bogus status: %s", txt)
	}
}

func TestPinsNumberPerWorkspace(t *testing.T) {
	s, _ := openTemp(t)
	other, err := s.CreateWorkspace("outro", "user")
	if err != nil {
		t.Fatal(err)
	}
	p1, _ := s.CreatePin("", NewPin{Text: "um"}, "user")
	p2, _ := s.CreatePin(other.ID, NewPin{Text: "dois"}, "user")
	if p1.N != 1 || p2.N != 1 || p2.WorkspaceID != other.ID {
		t.Fatalf("numbers: %d %d", p1.N, p2.N)
	}
	if n := len(mustPins(t, s, PinFilter{WorkspaceID: other.ID})); n != 1 {
		t.Fatalf("other workspace: %d", n)
	}
	if n := s.CountOpenPins(""); n != 1 {
		t.Fatalf("active open: %d", n)
	}
}

func mustPins(t *testing.T, s *Store, f PinFilter) []Pin {
	t.Helper()
	p, err := s.ListPins(f)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestWriteResultsCarryOpenPins(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:a", nil)
	ctx := context.Background()
	rect := func() ToolResult {
		return m.CallTool(ctx, "create_nodes", jsonv.NewObject("nodes", []any{jsonv.NewObject("type", "rect", "x", 0.0, "y", 0.0, "width", 10.0, "height", 10.0)}, "place", "none"), true)
	}
	if structuredOf(t, rect()).Has("openPins") {
		t.Fatal("openPins without pins")
	}
	p, _ := s.CreatePin("", NewPin{Text: "x"}, "user")
	r := rect()
	if got := structuredOf(t, r).Num("openPins"); got != 1 {
		t.Fatalf("openPins = %v", got)
	}
	if !strings.Contains(callTextJoin(r), "call list_pins") {
		t.Fatalf("hint text missing: %s", callTextJoin(r))
	}
	if structuredOf(t, m.CallTool(ctx, "list_pins", jsonv.NewObject(), true)).Has("openPins") {
		t.Fatal("openPins on list_pins")
	}
	if _, err := s.ClaimPin(p.ID, "agent:a"); err != nil {
		t.Fatal(err)
	}
	if structuredOf(t, rect()).Has("openPins") {
		t.Fatal("claimed pin still counted")
	}
}

func TestWaitForPins(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:a", nil)
	ctx := context.Background()

	start := time.Now()
	out := structuredOf(t, m.CallTool(ctx, "wait_for_pins", jsonv.NewObject("timeoutMs", 200.0), true))
	if !out.Bool("timedOut") || time.Since(start) < 150*time.Millisecond {
		t.Fatalf("empty wait: %s after %v", jsonv.Stringify(out, ""), time.Since(start))
	}
	since := out.Num("rev")
	go func() {
		time.Sleep(200 * time.Millisecond)
		_, _ = s.CreatePin("", NewPin{Text: "novo"}, "user")
	}()
	out = structuredOf(t, m.CallTool(ctx, "wait_for_pins", jsonv.NewObject("timeoutMs", 5000.0, "since", since), true))
	pins := out.Arr("pins")
	if out.Bool("timedOut") || len(pins) != 1 || pins[0].(*jsonv.Object).Str("text") != "novo" {
		t.Fatalf("wait: %s", jsonv.Stringify(out, ""))
	}
	out = structuredOf(t, m.CallTool(ctx, "wait_for_pins", jsonv.NewObject("timeoutMs", 0.0, "since", out.Num("rev")), true))
	if !out.Bool("timedOut") {
		t.Fatalf("stale wait: %s", jsonv.Stringify(out, ""))
	}
}

func TestPinsHTTP(t *testing.T) {
	s, _ := openTemp(t)
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	code, body, _ := httpDo(t, srv, "POST", "/api/pins", nil, `{"nodeId":"n1","region":{"x":1,"y":2,"width":3,"height":4},"text":"maior"}`)
	if code != 201 {
		t.Fatalf("create: %d %s", code, body)
	}
	var created struct{ Pin Pin }
	_ = json.Unmarshal([]byte(body), &created)
	if created.Pin.Author != "user" || created.Pin.Region.Height != 4 {
		t.Fatalf("created: %s", body)
	}
	if code, body, _ := httpDo(t, srv, "POST", "/api/pins", nil, `{"region":{"x":1,"y":2,"width":-3,"height":4},"text":"x"}`); code != 400 {
		t.Fatalf("negative width: %d %s", code, body)
	}
	if code, body, _ := httpDo(t, srv, "PATCH", "/api/pins/"+created.Pin.ID, nil, `{"text":"bem maior"}`); code != 200 || !strings.Contains(body, "bem maior") {
		t.Fatalf("edit: %d %s", code, body)
	}
	if code, body, _ := httpDo(t, srv, "POST", "/api/pins/"+created.Pin.ID+"/replies", nil, `{"text":"pode ser 18"}`); code != 201 || !strings.Contains(body, "pode ser 18") {
		t.Fatalf("reply: %d %s", code, body)
	}
	if code, body, _ := httpDo(t, srv, "PATCH", "/api/pins/"+created.Pin.ID, nil, `{"status":"resolved"}`); code != 200 || !strings.Contains(body, `"resolved"`) {
		t.Fatalf("resolve: %d %s", code, body)
	}
	if code, body, _ := httpDo(t, srv, "PATCH", "/api/pins/"+created.Pin.ID, nil, `{"status":"open"}`); code != 200 || !strings.Contains(body, `"open"`) {
		t.Fatalf("reopen: %d %s", code, body)
	}
	if code, body, _ := httpDo(t, srv, "GET", "/api/pins", nil, ""); code != 200 || !strings.Contains(body, created.Pin.ID) {
		t.Fatalf("list: %d %s", code, body)
	}
	if code, body, _ := httpDo(t, srv, "DELETE", "/api/pins/"+created.Pin.ID, nil, ""); code != 200 {
		t.Fatalf("delete: %d %s", code, body)
	}
	if code, _, _ := httpDo(t, srv, "GET", "/api/pins/"+created.Pin.ID, nil, ""); code != 404 {
		t.Fatalf("get deleted: %d", code)
	}
	if code, _, _ := httpDo(t, srv, "GET", "/api/pins?workspaceId=nope", nil, ""); code != 404 {
		t.Fatalf("unknown workspace: %d", code)
	}
}

func TestPinsReanchor(t *testing.T) {
	s, _ := openTemp(t)
	a := NewMCP(s, "agent:a", nil)
	b := NewMCP(s, "agent:b", nil)
	ctx := context.Background()
	draw := func(id string, x float64) {
		structuredOf(t, a.CallTool(ctx, "create_nodes", jsonv.NewObject("nodes", []any{
			jsonv.NewObject("type", "frame", "id", id, "x", x, "y", 30.0, "width", 200.0, "height", 120.0),
		}, "place", "none"), true))
	}
	draw("hero", 0)
	pin, err := s.CreatePin("", NewPin{NodeID: "hero", Region: PinRegion{X: 0, Y: 30, Width: 200, Height: 120}, Text: "Refaça"}, "user")
	if err != nil || pin.NodeMissing {
		t.Fatalf("pin: %+v %v", pin, err)
	}
	structuredOf(t, a.CallTool(ctx, "delete_nodes", jsonv.NewObject("ids", []any{"hero"}), true))
	draw("hero2", 400)
	got, err := s.GetPin(pin.ID)
	if err != nil || !got.NodeMissing {
		t.Fatalf("expected nodeMissing: %+v %v", got, err)
	}
	if txt, isErr := callText(t, a, "update_pin", jsonv.NewObject("id", pin.ID, "nodeId", "ghost")); !isErr || !strings.Contains(txt, "does not exist") {
		t.Fatalf("unknown node: %v %s", isErr, txt)
	}
	fixed := structuredOf(t, a.CallTool(ctx, "update_pin", jsonv.NewObject("id", pin.ID, "nodeId", "hero2"), true)).Obj("pin")
	region := fixed.Obj("region")
	if fixed.Str("nodeId") != "hero2" || fixed.Bool("nodeMissing") || fixed.Str("status") != PinOpen || region.Num("x") != 400 || region.Num("y") != 30 || region.Num("width") != 200 || region.Num("height") != 120 {
		t.Fatalf("reanchored: %s", jsonv.Stringify(fixed, ""))
	}
	if after, _ := s.GetPin(pin.ID); after.Rev <= got.Rev {
		t.Fatalf("rev did not advance: %d <= %d", after.Rev, got.Rev)
	}
	structuredOf(t, a.CallTool(ctx, "claim_pin", jsonv.NewObject("id", pin.ID), true))
	if txt, isErr := callText(t, b, "update_pin", jsonv.NewObject("id", pin.ID, "nodeId", "hero2")); !isErr || !strings.Contains(txt, "claimed by another agent") {
		t.Fatalf("other agent: %v %s", isErr, txt)
	}
	draw("hero3", 800)
	if txt, isErr := callText(t, a, "resolve_pin", jsonv.NewObject("id", pin.ID, "reply", "feito", "nodeId", "ghost")); !isErr || !strings.Contains(txt, "does not exist") {
		t.Fatalf("resolve unknown node: %v %s", isErr, txt)
	}
	if cur, _ := s.GetPin(pin.ID); cur.Status != PinClaimed || len(cur.Replies) != 0 {
		t.Fatalf("failed resolve changed the pin: %+v", cur)
	}
	done := structuredOf(t, a.CallTool(ctx, "resolve_pin", jsonv.NewObject("id", pin.ID, "reply", "refeito", "nodeId", "hero3"), true)).Obj("pin")
	if done.Str("status") != PinResolved || done.Str("nodeId") != "hero3" || done.Obj("region").Num("x") != 800 || done.Bool("nodeMissing") {
		t.Fatalf("resolved with nodeId: %s", jsonv.Stringify(done, ""))
	}
	if txt, isErr := callText(t, a, "update_pin", jsonv.NewObject("id", pin.ID, "nodeId", "hero2")); !isErr || !strings.Contains(txt, "already resolved") {
		t.Fatalf("resolved pin: %v %s", isErr, txt)
	}
}
