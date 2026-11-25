package core

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

// RepeatModes lists the modes of repeat_nodes.
var RepeatModes = []string{"radial", "linear", "grid"}

var repeatOnly = map[string][]string{
	"radial": {"center", "angle", "rotate"},
	"linear": {"step"},
	"grid":   {"columns", "rows", "gap"},
}

func isWhole(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) && v == math.Trunc(v) }

type repeatSpot struct {
	x, y, rot float64
	hasRot    bool
}

// RepeatOps repeats one node args.count times (count-1 copies) along a circle, a line or a grid.
// Port of repeatOps in packages/core/src/structure.ts; the plan's Map keys are "<source id>#<copy>".
func RepeatOps(doc *Document, id string, args *jsonv.Object) (*DuplicatePlan, error) {
	src := GetNode(doc, id)
	if src == nil {
		return nil, fmt.Errorf(`node "%s" does not exist`, id)
	}
	mode := args.Str("mode")
	count := args.Num("count")
	known := false
	for _, m := range RepeatModes {
		if m == mode {
			known = true
		}
	}
	if !known {
		return nil, fmt.Errorf(`unknown mode "%s"; use radial, linear or grid`, mode)
	}
	if !isWhole(count) || count < 2 || count > 500 {
		return nil, errors.New("count must be a whole number from 2 to 500 (the source counts as one)")
	}
	for _, m := range RepeatModes {
		if m == mode {
			continue
		}
		var bad []string
		for _, k := range repeatOnly[m] {
			if args.Has(k) {
				bad = append(bad, k)
			}
		}
		if len(bad) > 0 {
			return nil, fmt.Errorf(`%s only work with mode "%s", not "%s"`, strings.Join(bad, ", "), m, mode)
		}
	}
	x0, _ := numOf(src, "x")
	y0, _ := numOf(src, "y")
	size := func() (float64, float64, error) {
		w, okW := numOf(src, "width")
		h, okH := numOf(src, "height")
		if !okW || !okH {
			return 0, 0, fmt.Errorf(`mode "%s" needs "%s" to have a numeric width and height`, mode, id)
		}
		return w, h, nil
	}
	n := int(count)
	var place func(k int) repeatSpot
	switch mode {
	case "radial":
		w, h, err := size()
		if err != nil {
			return nil, err
		}
		var cx, cy float64
		if c := args.Obj("center"); c != nil {
			cx, cy = c.Num("x"), c.Num("y")
		} else {
			var parent *Node
			if pid, ok := src.Get("parentId"); ok {
				if s, isStr := pid.(string); isStr && s != "" {
					parent = GetNode(doc, s)
				}
			}
			var pw, ph float64
			var okW, okH bool
			if parent != nil {
				pw, okW = numOf(parent, "width")
				ph, okH = numOf(parent, "height")
			}
			if parent == nil || parent.Str("type") == "page" || !okW || !okH {
				return nil, fmt.Errorf(`"%s" is not inside a sized frame: pass center {x, y} for the orbit`, id)
			}
			cx, cy = pw/2, ph/2
		}
		if math.IsNaN(cx+cy) || math.IsInf(cx+cy, 0) {
			return nil, errors.New("center must be finite numbers")
		}
		angle := 360.0
		if args.Has("angle") {
			angle = args.Num("angle")
		}
		if math.IsNaN(angle) || math.IsInf(angle, 0) || angle == 0 {
			return nil, errors.New("angle must be a non-zero number of degrees")
		}
		stepAngle := angle / (count - 1)
		if math.Abs(angle) >= 360 {
			stepAngle = angle / count
		}
		dx, dy := x0+w/2-cx, y0+h/2-cy
		if math.Hypot(dx, dy) < 1e-6 {
			return nil, fmt.Errorf(`"%s" is centered on the orbit center, so every copy would land on it: move it away or pass another center`, id)
		}
		rot0, _ := numOf(src, "rotation")
		rotate := args.Bool("rotate")
		place = func(k int) repeatSpot {
			a := stepAngle * float64(k) * math.Pi / 180
			cos, sin := math.Cos(a), math.Sin(a)
			s := repeatSpot{x: Round4(cx + dx*cos - dy*sin - w/2), y: Round4(cy + dx*sin + dy*cos - h/2)}
			if rotate {
				s.rot, s.hasRot = Round4(rot0+stepAngle*float64(k)), true
			}
			return s
		}
	case "linear":
		st := args.Obj("step")
		if st == nil {
			return nil, errors.New("mode linear needs step {x, y}")
		}
		sx, sy := st.Num("x"), st.Num("y")
		if math.IsNaN(sx+sy) || math.IsInf(sx+sy, 0) {
			return nil, errors.New("step must be finite numbers")
		}
		if sx == 0 && sy == 0 {
			return nil, errors.New("step is 0, 0: every copy would land on the source")
		}
		place = func(k int) repeatSpot {
			return repeatSpot{x: Round4(x0 + sx*float64(k)), y: Round4(y0 + sy*float64(k))}
		}
	default:
		w, h, err := size()
		if err != nil {
			return nil, err
		}
		columns := args.Num("columns")
		if !args.Has("columns") || !isWhole(columns) || columns < 1 || columns > 500 {
			return nil, errors.New("mode grid needs columns (a whole number from 1 to 500)")
		}
		if args.Has("rows") {
			rows := args.Num("rows")
			if !isWhole(rows) || rows < 1 {
				return nil, errors.New("rows must be a whole number from 1")
			}
			if rows*columns < count {
				return nil, fmt.Errorf("%s columns x %s rows hold %s nodes, count is %s", jsonv.FormatNumber(columns), jsonv.FormatNumber(rows), jsonv.FormatNumber(rows*columns), jsonv.FormatNumber(count))
			}
		}
		gap := args.Num("gap")
		if math.IsNaN(gap) || math.IsInf(gap, 0) {
			return nil, errors.New("gap must be a finite number")
		}
		cols := int(columns)
		place = func(k int) repeatSpot {
			return repeatSpot{x: Round4(x0 + float64(k%cols)*(w+gap)), y: Round4(y0 + float64(k/cols)*(h+gap))}
		}
	}
	plan := &DuplicatePlan{Ops: []any{}, Copies: []string{}, Map: jsonv.NewObject()}
	for k := 1; k < n; k++ {
		one, err := DuplicateOps(doc, []string{id}, jsonv.NewObject("offset", 0.0))
		if err != nil {
			return nil, err
		}
		node := one.Ops[0].(*jsonv.Object).Obj("node")
		at := place(k)
		node.Set("x", at.x)
		node.Set("y", at.y)
		if at.hasRot {
			node.Set("rotation", at.rot)
		}
		plan.Ops = append(plan.Ops, one.Ops...)
		plan.Copies = append(plan.Copies, one.Copies...)
		for _, from := range one.Map.Keys() {
			to, _ := one.Map.Get(from)
			plan.Map.Set(from+"#"+strconv.Itoa(k), to)
		}
	}
	return plan, nil
}
