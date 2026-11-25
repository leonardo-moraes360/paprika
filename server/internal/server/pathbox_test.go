package server

import (
	"math"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
)

func inkOf(t *testing.T, s *Store, id string) (x, y, w, h float64) {
	t.Helper()
	n := core.GetNode(s.Doc(), id)
	segs, err := core.ParsePath(n.Str("d"))
	if err != nil {
		t.Fatal(err)
	}
	b := core.PathBounds(segs)
	return n.Num("x") + b.X, n.Num("y") + b.Y, b.Width, b.Height
}

func TestPathCreateAndUpdateHugTheInk(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	p := obj("type", "path", "id", "p", "x", 0.0, "y", 0.0, "d", "M200 120 L260 120 L230 180 Z", "fill", "#c43d27")
	if out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{p})); isErr {
		t.Fatal(out)
	}
	n := core.GetNode(s.Doc(), "p")
	if n.Num("x") != 200 || n.Num("y") != 120 || n.Num("width") != 60 || n.Num("height") != 60 {
		t.Fatalf("create: %s", core.DescribeNode(n))
	}
	up := obj("updates", []any{obj("id", "p", "props", obj("d", "M10 300 L70 300 L40 350 Z"))})
	if out, isErr := callText(t, m, "update_nodes", up); isErr {
		t.Fatal(out)
	}
	x, y, w, h := inkOf(t, s, "p")
	n = core.GetNode(s.Doc(), "p")
	if x != 210 || y != 420 || w != 60 || h != 50 || n.Num("width") != 60 || n.Num("height") != 50 {
		t.Fatalf("update: ink %v %v %v %v, node %s", x, y, w, h, core.DescribeNode(n))
	}
	off := obj("updates", []any{obj("id", "p", "props", obj("d", "M10 10 L70 10 L40 60 Z", "normalize", false))})
	if out, isErr := callText(t, m, "update_nodes", off); isErr {
		t.Fatal(out)
	}
	if n = core.GetNode(s.Doc(), "p"); n.Str("d") != "M10 10 L70 10 L40 60 Z" || n.Num("width") != 60 {
		t.Fatalf("normalize false: %s", core.DescribeNode(n))
	}
}

func TestNormalizePaths(t *testing.T) {
	s, _ := openTemp(t)
	m := NewMCP(s, "agent:test", nil)
	frame := obj("type", "frame", "id", "f", "x", 0.0, "y", 0.0, "width", 600.0, "height", 600.0, "children", []any{
		obj("type", "path", "id", "a", "x", 0.0, "y", 0.0, "d", "M200 120 L260 120 L230 180 Z", "normalize", false, "fill", "#c43d27"),
		obj("type", "path", "id", "r", "x", 300.0, "y", 100.0, "rotation", 30.0, "d", "M40 30 L140 30 L90 90 Z", "normalize", false, "fill", "#1e2336"),
		obj("type", "path", "id", "ok", "x", 10.0, "y", 10.0, "d", "M0 0 L20 0 L20 20 Z"),
		obj("type", "path", "id", "vb", "x", 0.0, "y", 0.0, "width", 24.0, "height", 24.0, "viewBox", []any{0.0, 0.0, 24.0, 24.0}, "d", "M5 5 L19 5 L19 19 Z"),
	})
	if out, isErr := callText(t, m, "create_nodes", obj("nodes", []any{frame})); isErr {
		t.Fatal(out)
	}
	ax, ay, aw, ah := inkOf(t, s, "a")

	out, isErr := callText(t, m, "normalize_paths", obj("rootId", "f"))
	if isErr || !strings.Contains(out, `"unchanged": 1`) || !strings.Contains(out, "viewBox") {
		t.Fatalf("normalize_paths: %v %s", isErr, out)
	}
	n := core.GetNode(s.Doc(), "a")
	if n.Num("x") != 200 || n.Num("y") != 120 || n.Num("width") != 60 || n.Num("height") != 60 {
		t.Fatalf("a: %s", core.DescribeNode(n))
	}
	if x, y, w, h := inkOf(t, s, "a"); x != ax || y != ay || w != aw || h != ah {
		t.Fatalf("ink of a moved: %v %v %v %v", x, y, w, h)
	}
	rn := core.GetNode(s.Doc(), "r")
	if rn.Num("width") != 100 || rn.Num("height") != 60 {
		t.Fatalf("r box: %s", core.DescribeNode(rn))
	}
	cx, cy := rn.Num("x")+rn.Num("width")/2, rn.Num("y")+rn.Num("height")/2
	th := 30 * math.Pi / 180
	nxp := cx + math.Cos(th)*(0-rn.Num("width")/2) - math.Sin(th)*(0-rn.Num("height")/2)
	nyp := cy + math.Sin(th)*(0-rn.Num("width")/2) + math.Cos(th)*(0-rn.Num("height")/2)
	ocx, ocy := 300.0+140.0/2, 100.0+90.0/2
	oxp := ocx + math.Cos(th)*(40-70) - math.Sin(th)*(30-45)
	oyp := ocy + math.Sin(th)*(40-70) + math.Cos(th)*(30-45)
	if math.Abs(nxp-oxp) > 0.01 || math.Abs(nyp-oyp) > 0.01 {
		t.Fatalf("rotated ink moved: (%v,%v) -> (%v,%v)", oxp, oyp, nxp, nyp)
	}
	if out, isErr = callText(t, m, "undo", obj()); isErr {
		t.Fatal(out)
	}
	if n = core.GetNode(s.Doc(), "a"); n.Num("x") != 0 || n.Num("width") != 260 {
		t.Fatalf("undo: %s", core.DescribeNode(n))
	}
	if _, isErr = callText(t, m, "normalize_paths", obj()); isErr {
		t.Fatal("whole workspace")
	}
	out, isErr = callText(t, m, "normalize_paths", obj())
	if isErr || !strings.Contains(out, `"normalized": []`) {
		t.Fatalf("second run: %v %s", isErr, out)
	}
	if out, isErr = callText(t, m, "normalize_paths", obj("ids", []any{"a"}, "rootId", "f")); !isErr {
		t.Fatalf("ids and rootId: %s", out)
	}
}
