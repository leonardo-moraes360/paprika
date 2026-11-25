package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// compareScene is a 200x120 picture: white, a red disc and a navy bar, moved by (dx, dy).
func compareScene(t *testing.T, dx, dy int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 200, 120))
	for y := range 120 {
		for x := range 200 {
			c := color.NRGBA{255, 255, 255, 255}
			if ex, ey := x-dx-45, y-dy-60; ex*ex+ey*ey <= 30*30 {
				c = color.NRGBA{220, 30, 40, 255}
			}
			if x-dx >= 100 && x-dx < 180 && y-dy >= 40 && y-dy < 80 {
				c = color.NRGBA{20, 40, 110, 255}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// sceneShot answers every screenshot with one fixed picture and remembers the document it got.
type sceneShot struct {
	memShot
	doc *core.Document
}

func (s *sceneShot) ScreenshotMode(_ context.Context, doc *core.Document, _ string, _ float64, _ string) ([]byte, int, int, error) {
	s.doc = doc
	return append([]byte(nil), s.png...), s.w, s.h, nil
}

func compareSetup(t *testing.T) (*MCP, *Store, *sceneShot) {
	t.Helper()
	t.Setenv("PAPRIKA_CHROMIUM", "")
	s, _ := openTemp(t)
	shot := &sceneShot{memShot: memShot{png: compareScene(t, 0, 0), w: 200, h: 120}}
	m := NewMCP(s, "agent:test", shot)
	if out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{obj(
		"type", "frame", "id", "f", "x", 0.0, "y", 0.0, "width", 200.0, "height", 120.0, "fill", "#ffffff",
		"children", []any{
			obj("type", "ellipse", "id", "disc", "x", 15.0, "y", 30.0, "width", 60.0, "height", 60.0, "fill", "#dc1e28"),
			obj("type", "rect", "id", "bar", "x", 100.0, "y", 40.0, "width", 80.0, "height", 40.0, "fill", "#14286e"),
		},
	)}, "place", "none")); isErr {
		t.Fatal(out)
	}
	return m, s, shot
}

func compareCall(t *testing.T, m *MCP, args *jsonv.Object) (*jsonv.Object, string, *jsonv.Object) {
	t.Helper()
	r := m.CallTool(context.Background(), "compare_reference", args, true)
	var text strings.Builder
	for _, c := range r.Arr("content") {
		if o := c.(*jsonv.Object); o.Str("type") == "text" {
			text.WriteString(o.Str("text"))
		}
	}
	if r.Bool("isError") {
		t.Fatalf("compare_reference: %s", text.String())
	}
	return r.Obj("structuredContent"), text.String(), r
}

func dataURL(b []byte) string { return "data:image/png;base64," + base64.StdEncoding.EncodeToString(b) }

func TestCompareReferenceOffsetHistoryAndDiff(t *testing.T) {
	m, s, _ := compareSetup(t)
	ref := dataURL(compareScene(t, 12, 7)) // the reference sits 12 right and 7 down of the drawing
	sc, text, _ := compareCall(t, m, obj("reference", ref, "rootId", "f", "path", "diffs/round1.png"))
	if sc.Num("iou") > 0.7 || sc.Bool("pass") || sc.Num("target") != 0.9 {
		t.Fatalf("scores: %s", text)
	}
	if sc.Obj("rawPixelMatch").Num("value") < 0.85 {
		t.Fatalf("raw match: %s", text)
	}
	al := sc.Obj("alignment")
	if math.Abs(al.Num("dx")-12) > 1.5 || math.Abs(al.Num("dy")-7) > 1.5 || !al.Bool("significant") || al.Num("iouAfter") < 0.95 {
		t.Fatalf("alignment: %s", jsonv.Stringify(al, ""))
	}
	if sc.Obj("frame").Num("width") != 200 || sc.Obj("reference").Obj("placed").Num("width") != 200 {
		t.Fatalf("frame: %s", jsonv.Stringify(sc, ""))
	}
	if sc.Obj("previous") != nil {
		t.Fatal("no previous round yet")
	}
	for _, want := range []string{"compare_reference f 200x120", "iou ", "FAIL", "align: move everything by (+12", "raw pixel match", "misleading"} {
		if !strings.Contains(text, want) {
			t.Fatalf("summary lacks %q:\n%s", want, text)
		}
	}
	diff := sc.Obj("diff")
	if !strings.HasPrefix(diff.Str("url"), "/api/screenshot/") || diff.Num("width") != 200 {
		t.Fatalf("diff: %s", jsonv.Stringify(diff, ""))
	}
	data, err := os.ReadFile(diff.Str("path"))
	if err != nil {
		t.Fatal(err)
	}
	if img, err := png.Decode(bytes.NewReader(data)); err != nil || img.Bounds().Dx() != 200 {
		t.Fatalf("diff png: %v", err)
	}
	if !strings.HasSuffix(diff.Str("path"), "diffs/round1.png") {
		t.Fatalf("diff path: %s", diff.Str("path"))
	}

	// the same call again: previous and delta are filled in
	again, text2, _ := compareCall(t, m, obj("reference", ref, "rootId", "f"))
	if prev := again.Obj("previous"); prev == nil || prev.Num("iou") != sc.Num("iou") || !again.Bool("sameReference") || again.Obj("delta").Num("iou") != 0 {
		t.Fatalf("history: %s", jsonv.Stringify(again, ""))
	}
	if !strings.Contains(text2, "previous round") {
		t.Fatalf("summary: %s", text2)
	}

	// a drawing that now matches improves on the previous round; the same root keeps one history
	shot := NewMCP(s, "agent:test", &sceneShot{memShot: memShot{png: compareScene(t, 12, 7), w: 200, h: 120}})
	better, _, _ := compareCall(t, shot, obj("reference", ref, "rootId", "f", "target", 0.95))
	if !better.Bool("pass") || better.Num("iou") < 0.99 || better.Obj("delta").Num("iou") <= 0.3 {
		t.Fatalf("matching drawing: %s", jsonv.Stringify(better, ""))
	}
	if better.Obj("alignment").Bool("significant") {
		t.Fatalf("nothing left to align: %s", jsonv.Stringify(better.Obj("alignment"), ""))
	}
}

func TestCompareReferenceRegionsAndNodes(t *testing.T) {
	m, _, shot := compareSetup(t)
	// reference with the bar 20 px to the right: the bar is the node to move, and the old and new
	// places show up as regions
	ref := dataURL(func() []byte {
		img := image.NewNRGBA(image.Rect(0, 0, 200, 120))
		for y := range 120 {
			for x := range 200 {
				c := color.NRGBA{255, 255, 255, 255}
				if ex, ey := x-45, y-60; ex*ex+ey*ey <= 900 {
					c = color.NRGBA{220, 30, 40, 255}
				}
				if x >= 120 && x < 200 && y >= 40 && y < 80 {
					c = color.NRGBA{20, 40, 110, 255}
				}
				img.SetNRGBA(x, y, c)
			}
		}
		var buf bytes.Buffer
		_ = png.Encode(&buf, img)
		return buf.Bytes()
	}())
	sc, text, _ := compareCall(t, m, obj("reference", ref, "rootId", "f"))
	kinds := map[string]int{}
	for _, r := range sc.Arr("regions") {
		kinds[r.(*jsonv.Object).Str("kind")]++
	}
	if kinds["missing"] != 1 || kinds["extra"] != 1 {
		t.Fatalf("regions: %s", text)
	}
	nodes := sc.Arr("nodes")
	if len(nodes) != 1 || nodes[0].(*jsonv.Object).Str("id") != "bar" {
		t.Fatalf("nodes: %s", text)
	}
	if mv := nodes[0].(*jsonv.Object).Obj("suggestedMove"); mv == nil || math.Abs(mv.Num("dx")-20) > 2 {
		t.Fatalf("move: %s", text)
	}
	if shot.doc == nil {
		t.Fatal("the screenshotter got no document")
	}
	if sc.Num("nodeCount") < 1 || sc.Obj("byKind") == nil || sc.Obj("byKind").Num("rect") < 1 {
		t.Fatalf("nodeCount %v byKind %v", sc.Num("nodeCount"), sc.Obj("byKind"))
	}
	if !strings.Contains(text, "nodes: ") {
		t.Fatalf("the summary lacks the node count: %s", text)
	}
	if !strings.Contains(text, "missing regions") || !strings.Contains(text, "extra regions") || !strings.Contains(text, "bar") {
		t.Fatalf("summary: %s", text)
	}
}

func TestCompareReferenceNodeIsLeftOutOfTheRender(t *testing.T) {
	m, s, shot := compareSetup(t)
	scene := compareScene(t, 0, 0)
	if out, isErr := callText(t, m, "place_reference", obj("frameId", "f", "src", dataURL(scene))); isErr {
		t.Fatal(out)
	}
	var refID string
	for _, id := range core.Nodes(s.Doc()).Keys() {
		if core.GetNode(s.Doc(), id).Str("type") == "image" {
			refID = id
		}
	}
	if refID == "" {
		t.Fatal("no reference node")
	}
	sc, text, _ := compareCall(t, m, obj("reference", refID, "rootId", "f"))
	if sc.Num("iou") < 0.97 || !sc.Bool("pass") {
		t.Fatalf("a drawing equal to its reference: %s", text)
	}
	if got := sc.Obj("reference"); got.Str("source") != "node" || got.Str("nodeId") != refID {
		t.Fatalf("reference: %s", jsonv.Stringify(got, ""))
	}
	if n := core.GetNode(shot.doc, refID); n == nil || n.Bool("visible") {
		t.Fatalf("the reference node must be hidden in the render doc")
	}
	if n := core.GetNode(s.Doc(), refID); n == nil || (n.Has("visible") && !n.Bool("visible")) {
		t.Fatal("the stored document must not change")
	}
	if len(sc.Arr("nodes")) != 0 {
		t.Fatalf("hidden reference layer listed: %s", text)
	}
}

func TestCompareReferenceSources(t *testing.T) {
	m, _, _ := compareSetup(t)
	scene := compareScene(t, 0, 0)
	b64 := base64.StdEncoding.EncodeToString(scene)
	for name, ref := range map[string]string{"data url": dataURL(scene), "raw base64": b64} {
		sc, text, _ := compareCall(t, m, obj("reference", ref, "rootId", "f"))
		if sc.Num("iou") < 0.97 || sc.Obj("alignment").Bool("significant") {
			t.Fatalf("%s: %s", name, text)
		}
	}
	r := m.CallTool(context.Background(), "compare_reference", obj("reference", dataURL(scene), "rootId", "f", "includeDiff", true), true)
	img := 0
	for _, c := range r.Arr("content") {
		if c.(*jsonv.Object).Str("type") == "image" {
			img++
		}
	}
	if img != 1 {
		t.Fatalf("includeDiff: %d images", img)
	}
}

func TestCompareReferenceErrors(t *testing.T) {
	m, _, _ := compareSetup(t)
	scene := dataURL(compareScene(t, 0, 0))
	cases := []struct {
		name string
		args *jsonv.Object
		want string
	}{
		{"unknown root", obj("reference", scene, "rootId", "nope"), "not found"},
		{"unknown id", obj("reference", "nope", "rootId", "f"), "not a node"},
		{"not an image", obj("reference", "disc", "rootId", "f"), "not an image"},
		{"itself", obj("reference", "f", "rootId", "f"), "not an image"},
		{"outside", obj("reference", "/etc/passwd", "rootId", "f"), "outside the allowed"},
		{"http", obj("reference", "https://example.com/a.png", "rootId", "f"), "not fetched"},
		{"missing rootId", obj("reference", scene), "rootId"},
		{"bad target", obj("reference", scene, "rootId", "f", "target", 2.0), "target"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			text, isErr := callText(t, m, "compare_reference", c.args)
			if !isErr || !strings.Contains(text, c.want) {
				t.Fatalf("isErr=%v text=%q want %q", isErr, text, c.want)
			}
		})
	}
	s, _ := openTemp(t)
	if text, isErr := callText(t, NewMCP(s, "agent:test", nil), "compare_reference", obj("reference", scene, "rootId", "f")); !isErr || !strings.Contains(text, "screenshot unavailable") {
		t.Fatalf("no screenshotter: %q", text)
	}
}
