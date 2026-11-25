package server

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"math"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/export"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// rasterShot renders documents with the software exporter, so a fit sees real pixels of the
// document it is given (and of the clones the tool makes), without Chromium.
type rasterShot struct {
	memShot
	calls int
}

func (r *rasterShot) ScreenshotMode(_ context.Context, doc *core.Document, rootID string, scale float64, _ string) ([]byte, int, int, error) {
	r.calls++
	img, _, err := export.Rasterize(doc, rootID, scale)
	if err != nil {
		return nil, 0, 0, err
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, 0, 0, err
	}
	return buf.Bytes(), img.Bounds().Dx(), img.Bounds().Dy(), nil
}

// fitScene is a w x h picture, white with navy where in(x, y) holds.
func fitScene(t *testing.T, w, h int, in func(x, y float64) bool) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			c := color.NRGBA{255, 255, 255, 255}
			if in(float64(x)+0.5, float64(y)+0.5) {
				c = color.NRGBA{20, 40, 110, 255}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return dataURL(buf.Bytes())
}

func fitSetup(t *testing.T, children ...any) (*MCP, *Store, *rasterShot) {
	t.Helper()
	t.Setenv("PAPRIKA_CHROMIUM", "")
	s, _ := openTemp(t)
	shot := &rasterShot{}
	m := NewMCP(s, "agent:test", shot)
	if out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{obj(
		"type", "frame", "id", "f", "x", 0.0, "y", 0.0, "width", 300.0, "height", 200.0, "fill", "#ffffff",
		"children", children,
	)}, "place", "none")); isErr {
		t.Fatal(out)
	}
	return m, s, shot
}

func fitCall(t *testing.T, m *MCP, args *jsonv.Object) (*jsonv.Object, string) {
	t.Helper()
	r := m.CallTool(context.Background(), "fit_to_reference", args, true)
	text := callTextJoin(r)
	if r.Bool("isError") {
		t.Fatalf("fit_to_reference: %s", text)
	}
	return r.Obj("structuredContent"), text
}

func fitErr(t *testing.T, m *MCP, args *jsonv.Object) string {
	t.Helper()
	r := m.CallTool(context.Background(), "fit_to_reference", args, true)
	if !r.Bool("isError") {
		t.Fatalf("expected an error, got %s", callTextJoin(r))
	}
	return callTextJoin(r)
}

func nodeNum(t *testing.T, s *Store, id, key string) float64 {
	t.Helper()
	head, err := s.ReadWorkspace("")
	if err != nil {
		t.Fatal(err)
	}
	n := core.GetNode(head.Doc, id)
	if n == nil {
		t.Fatalf("no node %s", id)
	}
	return n.Num(key)
}

func TestFitToReferenceRectConvergesAsOneUndoStep(t *testing.T) {
	m, s, shot := fitSetup(t,
		obj("type", "rect", "id", "r", "x", 115.0, "y", 75.0, "width", 108.0, "height", 72.0, "fill", "#14286e"))
	ref := fitScene(t, 300, 200, func(x, y float64) bool { return x >= 100 && x < 220 && y >= 60 && y < 140 })
	before, _ := s.ReadWorkspace("")

	sc, text := fitCall(t, m, obj("rootId", "f", "ids", []any{"r"}, "reference", ref, "label", "fit rect"))
	if !sc.Bool("applied") || sc.Bool("dryRun") || sc.Num("version") != float64(before.Version+1) {
		t.Fatalf("not applied as one write: %s", jsonv.Stringify(sc, ""))
	}
	iou := sc.Obj("iou")
	if iou.Obj("chromium").Num("before") > 0.7 || iou.Obj("chromium").Num("after") < 0.97 || iou.Obj("mask").Num("after") < 0.97 {
		t.Fatalf("iou: %s", jsonv.Stringify(iou, ""))
	}
	t.Log(text)
	for key, want := range map[string]float64{"x": 100, "y": 60, "width": 120, "height": 80} {
		if got := nodeNum(t, s, "r", key); math.Abs(got-want) > 2 {
			t.Fatalf("%s = %v, want about %v\n%s", key, got, want, text)
		}
	}
	nodes := sc.Arr("nodes")
	if len(nodes) != 1 {
		t.Fatalf("nodes: %s", jsonv.Stringify(sc.Arr("nodes"), ""))
	}
	ch := nodes[0].(*jsonv.Object).Obj("changes")
	if ch.Obj("x").Num("before") != 115 || math.Abs(ch.Obj("x").Num("after")-100) > 2 || ch.Obj("rotation") != nil {
		t.Fatalf("changes: %s", jsonv.Stringify(ch, ""))
	}
	if sc.Num("iterations") < 1 || sc.Obj("canvas").Num("width") != 300 {
		t.Fatalf("iterations/canvas: %s", jsonv.Stringify(sc, ""))
	}
	if shot.calls != 3 {
		t.Fatalf("expected 3 renders (as is, without the tuned nodes, after), got %d", shot.calls)
	}
	for _, want := range []string{"fit_to_reference f (applied)", "chromium iou", "x 115 -> ", "width 108 -> "} {
		if !strings.Contains(text, want) {
			t.Fatalf("summary lacks %q:\n%s", want, text)
		}
	}

	// one undo step brings the first numbers back
	if _, isErr := callText(t, m, "undo", obj()); isErr {
		t.Fatal("undo failed")
	}
	if nodeNum(t, s, "r", "x") != 115 || nodeNum(t, s, "r", "width") != 108 {
		t.Fatal("undo did not restore the drawing in one step")
	}
}

func TestFitToReferenceDryRunLeavesTheDocument(t *testing.T) {
	m, s, _ := fitSetup(t,
		obj("type", "rect", "id", "r", "x", 115.0, "y", 75.0, "width", 108.0, "height", 72.0, "fill", "#14286e"))
	ref := fitScene(t, 300, 200, func(x, y float64) bool { return x >= 100 && x < 220 && y >= 60 && y < 140 })
	before, _ := s.ReadWorkspace("")
	sc, text := fitCall(t, m, obj("rootId", "f", "ids", []any{"r"}, "reference", ref, "dryRun", true))
	if sc.Bool("applied") || !sc.Bool("dryRun") || sc.Obj("iou").Obj("chromium").Num("after") < 0.97 {
		t.Fatalf("dry run: %s", jsonv.Stringify(sc, ""))
	}
	if !strings.Contains(text, "dry run, nothing written") {
		t.Fatalf("summary: %s", text)
	}
	after, _ := s.ReadWorkspace("")
	if after.Version != before.Version || nodeNum(t, s, "r", "x") != 115 || nodeNum(t, s, "r", "width") != 108 {
		t.Fatal("a dry run changed the document")
	}
}

func TestFitToReferenceEllipseRotation(t *testing.T) {
	m, s, _ := fitSetup(t,
		obj("type", "ellipse", "id", "e", "x", 70.0, "y", 72.0, "width", 160.0, "height", 56.0, "rotation", -20.0, "fill", "#14286e"))
	sin, cos := math.Sin(35*math.Pi/180), math.Cos(35*math.Pi/180)
	ref := fitScene(t, 300, 200, func(x, y float64) bool {
		dx, dy := x-150, y-100
		u, v := dx*cos+dy*sin, -dx*sin+dy*cos
		return (u/80)*(u/80)+(v/28)*(v/28) <= 1
	})
	sc, _ := fitCall(t, m, obj("rootId", "f", "ids", []any{"e"}, "reference", ref, "params", []any{"rotation"}))
	if !sc.Bool("applied") || sc.Obj("iou").Obj("chromium").Num("after") < 0.96 {
		t.Fatalf("ellipse: %s", jsonv.Stringify(sc, ""))
	}
	if r := nodeNum(t, s, "e", "rotation"); math.Abs(r-35) > 3 {
		t.Fatalf("rotation %v", r)
	}
	if nodeNum(t, s, "e", "x") != 70 || nodeNum(t, s, "e", "width") != 160 {
		t.Fatal("params not asked for moved")
	}
}

func TestFitToReferencePathAnchorFixesNotch(t *testing.T) {
	m, s, _ := fitSetup(t,
		obj("type", "path", "id", "p", "x", 100.0, "y", 50.0, "width", 100.0, "height", 100.0, "d", "M0 0 L100 0 L55 55 L0 100 Z", "fill", "#14286e"))
	ref := fitScene(t, 300, 200, func(x, y float64) bool { return x >= 100 && x < 200 && y >= 50 && y < 150 })
	sc, text := fitCall(t, m, obj("rootId", "f", "ids", []any{"p"}, "reference", ref, "params", []any{"pathPoints"}))
	if !sc.Bool("applied") || sc.Obj("iou").Obj("chromium").Num("before") > 0.9 || sc.Obj("iou").Obj("chromium").Num("after") < 0.96 {
		t.Fatalf("path: %s\n%s", jsonv.Stringify(sc, ""), text)
	}
	moves := sc.Arr("nodes")[0].(*jsonv.Object).Arr("pathPoints")
	if len(moves) != 1 || moves[0].(*jsonv.Object).Num("index") != 2 {
		t.Fatalf("only anchor 2 moves: %s", jsonv.Stringify(moves, ""))
	}
	head, _ := s.ReadWorkspace("")
	segs, err := core.ParsePath(core.GetNode(head.Doc, "p").Str("d"))
	if err != nil {
		t.Fatal(err)
	}
	b := core.PathBounds(segs)
	if math.Abs(b.Width-100) > 3 || math.Abs(b.Height-100) > 3 {
		t.Fatalf("path bounds after the fit: %+v (d=%s)", b, core.GetNode(head.Doc, "p").Str("d"))
	}
	if !strings.Contains(text, "anchor 2") {
		t.Fatalf("summary: %s", text)
	}
}

func TestFitToReferenceRotatedPathKeepsItsPivot(t *testing.T) {
	m, _, _ := fitSetup(t,
		obj("type", "path", "id", "p", "x", 100.0, "y", 50.0, "width", 100.0, "height", 100.0, "rotation", 25.0, "d", "M0 0 L100 0 L55 55 L0 100 Z", "fill", "#14286e"))
	sin, cos := math.Sin(25*math.Pi/180), math.Cos(25*math.Pi/180)
	ref := fitScene(t, 300, 200, func(x, y float64) bool {
		dx, dy := x-150, y-100 // the square turned 25 degrees about its center
		u, v := dx*cos+dy*sin, -dx*sin+dy*cos
		return math.Abs(u) <= 50 && math.Abs(v) <= 50
	})
	sc, text := fitCall(t, m, obj("rootId", "f", "ids", []any{"p"}, "reference", ref, "params", []any{"pathPoints"}))
	if !sc.Bool("applied") || sc.Obj("iou").Obj("chromium").Num("after") < 0.95 {
		t.Fatalf("rotated path: %s\n%s", jsonv.Stringify(sc.Obj("iou"), ""), text)
	}
	if got, want := sc.Obj("iou").Obj("chromium").Num("after"), sc.Obj("iou").Obj("mask").Num("after"); math.Abs(got-want) > 0.03 {
		t.Fatalf("what was written (%v) is not what was fitted (%v)", got, want)
	}
}

func TestFitToReferenceErrors(t *testing.T) {
	m, _, _ := fitSetup(t,
		obj("type", "rect", "id", "r", "x", 10.0, "y", 10.0, "width", 40.0, "height", 40.0, "fill", "#14286e"),
		obj("type", "text", "id", "t", "x", 60.0, "y", 10.0, "text", "hi", "color", "#000000"))
	obj2, _ := callText(t, m, "create_nodes", obj("nodes", []any{obj("type", "rect", "id", "outside", "x", 400.0, "y", 0.0, "width", 20.0, "height", 20.0, "fill", "#ff0000")}, "place", "none"))
	_ = obj2
	ref := fitScene(t, 300, 200, func(x, y float64) bool { return x >= 100 && x < 220 && y >= 60 && y < 140 })
	for name, tc := range map[string]struct {
		args *jsonv.Object
		want string
	}{
		"not under root": {obj("rootId", "f", "ids", []any{"outside"}, "reference", ref), `not under rootId "f"`},
		"root itself":    {obj("rootId", "f", "ids", []any{"f"}, "reference", ref), "is the frame being fitted"},
		"missing node":   {obj("rootId", "f", "ids", []any{"nope"}, "reference", ref), `node "nope" not found`},
		"missing root":   {obj("rootId", "nope", "ids", []any{"r"}, "reference", ref), `node "nope" not found`},
		"text only":      {obj("rootId", "f", "ids", []any{"t"}, "reference", ref), "none of the nodes can be fitted"},
		"bad reference":  {obj("rootId", "f", "ids", []any{"r"}, "reference", "no-such-node"), "no-such-node"},
	} {
		if got := fitErr(t, m, tc.args); !strings.Contains(got, tc.want) {
			t.Fatalf("%s: %q lacks %q", name, got, tc.want)
		}
	}
	// unknown params are refused by the schema
	if got := fitErr(t, m, obj("rootId", "f", "ids", []any{"r"}, "reference", ref, "params", []any{"colour"})); got == "" {
		t.Fatal("expected an error for an unknown param")
	}
}

func TestFitToReferenceSkipsWhatItCannotTune(t *testing.T) {
	m, s, _ := fitSetup(t,
		obj("type", "rect", "id", "r", "x", 110.0, "y", 70.0, "width", 120.0, "height", 80.0, "fill", "#14286e"),
		obj("type", "rect", "id", "lock", "x", 5.0, "y", 5.0, "width", 20.0, "height", 20.0, "fill", "#14286e", "locked", true))
	ref := fitScene(t, 300, 200, func(x, y float64) bool { return x >= 100 && x < 220 && y >= 60 && y < 140 })
	sc, text := fitCall(t, m, obj("rootId", "f", "ids", []any{"r", "lock"}, "reference", ref))
	var skipped string
	for _, n := range sc.Arr("nodes") {
		if o := n.(*jsonv.Object); o.Str("id") == "lock" {
			skipped = o.Str("skipped")
		}
	}
	if !strings.Contains(skipped, "locked") || nodeNum(t, s, "lock", "x") != 5 {
		t.Fatalf("locked node: %q\n%s", skipped, text)
	}
	if !sc.Bool("applied") || math.Abs(nodeNum(t, s, "r", "x")-100) > 2 {
		t.Fatalf("the other node is still tuned: %s", jsonv.Stringify(sc, ""))
	}
}

func TestFitToReferenceNothingToDo(t *testing.T) {
	m, s, _ := fitSetup(t,
		obj("type", "rect", "id", "r", "x", 100.0, "y", 60.0, "width", 120.0, "height", 80.0, "fill", "#14286e"))
	ref := fitScene(t, 300, 200, func(x, y float64) bool { return x >= 100 && x < 220 && y >= 60 && y < 140 })
	before, _ := s.ReadWorkspace("")
	sc, _ := fitCall(t, m, obj("rootId", "f", "ids", []any{"r"}, "reference", ref))
	after, _ := s.ReadWorkspace("")
	if sc.Bool("applied") || after.Version != before.Version || !sc.Bool("pass") {
		t.Fatalf("already fitted: %s", jsonv.Stringify(sc, ""))
	}
}
