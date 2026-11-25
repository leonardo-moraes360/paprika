package server

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"math"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func traceCall(t *testing.T, m *MCP, args *jsonv.Object) (*jsonv.Object, string, bool) {
	t.Helper()
	r := m.CallTool(t.Context(), "trace_image", args, true)
	return r.Obj("structuredContent"), callTextJoin(r), r.Bool("isError")
}

func TestTraceImageCreatesPathsInFrame(t *testing.T) {
	m, s, _ := resizeSetup(t)
	if _, err := s.Apply([]any{obj("op", "create", "node", obj("type", "frame", "id", "screen", "name", "Screen", "width", 400.0, "height", 400.0))}, "test", "frame"); err != nil {
		t.Fatal(err)
	}
	src := "data:image/png;base64," + base64.StdEncoding.EncodeToString(logoPNG(t))
	// 200x100 into 400x400: scale 2, y offset 100
	sc, text, isErr := traceCall(t, m, obj("src", src, "parentId", "screen", "batch", "trace"))
	if isErr {
		t.Fatal(text)
	}
	paths := sc.Arr("paths")
	if len(paths) != 2 || int(sc.Num("nodeCount")) != 3 || sc.Bool("dryRun") || sc.Bool("truncated") {
		t.Fatalf("result: %s", text)
	}
	frame := core.GetNode(s.Doc(), "screen")
	kids := frame.Strings("children")
	if len(kids) != 1 {
		t.Fatalf("one group under the frame, got %v", kids)
	}
	group := core.GetNode(s.Doc(), kids[0])
	if group.Str("type") != "group" || len(group.Strings("children")) != 2 {
		t.Fatalf("group: %s", jsonv.Stringify(group, ""))
	}
	first := paths[0].(*jsonv.Object)
	disc := core.GetNode(s.Doc(), first.Str("id"))
	if disc == nil || disc.Str("type") != "path" || disc.Str("fill") != "#dc1e28" || first.Num("holes") != 0 {
		t.Fatalf("disc path: %v %s", first, jsonv.Stringify(first, ""))
	}
	if first.Has("d") {
		t.Fatal("d is only returned on a dry run")
	}
	// the group's box is the ink of both shapes, in frame space: disc center (100,200) r 60
	gx, gy := group.Num("x"), group.Num("y")
	dx, dy := disc.Num("x")+gx, disc.Num("y")+gy
	if math.Abs(dx-40) > 3 || math.Abs(dy-140) > 3 || math.Abs(disc.Num("width")-120) > 4 || math.Abs(disc.Num("height")-120) > 4 {
		t.Fatalf("disc box at (%g, %g) %gx%g, group (%g, %g)", dx, dy, disc.Num("width"), disc.Num("height"), gx, gy)
	}
	if !strings.Contains(text, "traced 2 path(s)") {
		t.Fatalf("summary: %s", text)
	}

	// one undo step (same batch)
	if _, isErr := callText(t, m, "undo", obj()); isErr {
		t.Fatal("undo failed")
	}
	if kids := core.GetNode(s.Doc(), "screen").Strings("children"); len(kids) != 0 {
		t.Fatalf("undo left %v", kids)
	}

	// group: false, with a dry run first
	dry, text, isErr := traceCall(t, m, obj("src", src, "parentId", "screen", "dryRun", true))
	if isErr || !dry.Bool("dryRun") || int(dry.Num("nodeCount")) != 0 || len(core.GetNode(s.Doc(), "screen").Strings("children")) != 0 {
		t.Fatalf("dry run: %s", text)
	}
	if d := dry.Arr("paths")[0].(*jsonv.Object).Str("d"); !strings.HasPrefix(d, "M") || !strings.HasSuffix(d, "Z") {
		t.Fatalf("d: %q", d)
	}
	sc, text, isErr = traceCall(t, m, obj("src", src, "parentId", "screen", "group", false, "colors", []any{"#dc1e28"}))
	if isErr || len(sc.Arr("paths")) != 1 || int(sc.Num("nodeCount")) != 1 {
		t.Fatalf("ungrouped: %s", text)
	}
	if kid := core.GetNode(s.Doc(), core.GetNode(s.Doc(), "screen").Strings("children")[0]); kid.Str("type") != "path" {
		t.Fatalf("expected a bare path, got %s", kid.Str("type"))
	}
}

func TestTraceImageRingGetsEvenOdd(t *testing.T) {
	m, s, _ := resizeSetup(t)
	if _, err := s.Apply([]any{obj("op", "create", "node", obj("type", "frame", "id", "f", "width", 300.0, "height", 300.0))}, "test", "frame"); err != nil {
		t.Fatal(err)
	}
	src := "data:image/png;base64," + base64.StdEncoding.EncodeToString(ringPNG(t))
	sc, text, isErr := traceCall(t, m, obj("src", src, "parentId", "f", "group", false))
	if isErr || len(sc.Arr("paths")) != 1 {
		t.Fatalf("ring: %s", text)
	}
	p := sc.Arr("paths")[0].(*jsonv.Object)
	n := core.GetNode(s.Doc(), p.Str("id"))
	if p.Num("holes") != 1 || n.Str("fillRule") != "evenodd" || strings.Count(n.Str("d"), "M") != 2 {
		t.Fatalf("ring node: %s", jsonv.Stringify(n, ""))
	}
}

func TestTraceImageErrors(t *testing.T) {
	m, s, _ := resizeSetup(t)
	if _, err := s.Apply([]any{obj("op", "create", "node", obj("type", "frame", "id", "f", "width", 100.0, "height", 100.0, "children", []any{obj("type", "rect", "id", "r", "width", 5.0, "height", 5.0)}))}, "test", "frame"); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		args *jsonv.Object
		want string
	}{
		{"neither", obj("parentId", "f"), "requires src"},
		{"both", obj("src", "pixel.png", "nodeId", "x", "parentId", "f"), "not both"},
		{"no parent", obj("src", "pixel.png"), "requires parentId"},
		{"missing parent", obj("src", "pixel.png", "parentId", "nope"), "not found"},
		{"leaf parent", obj("src", "pixel.png", "parentId", "r"), "only frame"},
		{"avif", obj("src", "pixel.avif", "parentId", "f"), "AVIF"},
		{"bad color", obj("src", "pixel.png", "parentId", "f", "colors", []any{"red"}), "not a hex color"},
		{"region outside", obj("src", "pixel.png", "parentId", "f", "region", obj("x", 900.0, "y", 900.0, "width", 10.0, "height", 10.0)), "outside the image"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, text, isErr := traceCall(t, m, c.args)
			if !isErr || !strings.Contains(text, c.want) {
				t.Fatalf("isErr=%v text=%q want %q", isErr, text, c.want)
			}
		})
	}
	// a dry run needs no parent and answers in source pixels
	sc, text, isErr := traceCall(t, m, obj("src", "pixel.jpg", "dryRun", true))
	if isErr || !sc.Bool("dryRun") {
		t.Fatalf("dry run without parent: %s", text)
	}
}

// ringPNG is a 160x160 image: a red ring (radii 30 and 70) on white.
func ringPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 160, 160))
	for y := range 160 {
		for x := range 160 {
			c := color.NRGBA{255, 255, 255, 255}
			if d := math.Hypot(float64(x)+0.5-80, float64(y)+0.5-80); d >= 30 && d <= 70 {
				c = color.NRGBA{220, 30, 40, 255}
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
