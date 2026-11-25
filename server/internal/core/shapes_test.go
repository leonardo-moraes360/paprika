package core

import (
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func TestGoldenShapes(t *testing.T) {
	g := loadGolden(t)
	cases := g.Arr("shapeCases")
	if len(cases) == 0 {
		t.Fatal("shapeCases fixture missing: run pnpm go:golden")
	}
	for _, v := range cases {
		c := v.(*jsonv.Object)
		var value any
		var err error
		if c.Str("op") == "round" {
			var radii []*float64
			for _, r := range c.Arr("radii") {
				if f, ok := r.(float64); ok {
					radii = append(radii, &f)
				} else {
					radii = append(radii, nil)
				}
			}
			value, err = RoundPathCorners(c.Str("d"), c.Num("radius"), radii)
		} else {
			var s *PathShape
			s, err = BuildPathShape(c.Str("kind"), ShapeParamsFromJSON(c.Obj("params")))
			if err == nil {
				o := jsonv.NewObject("d", s.D, "width", s.Width, "height", s.Height, "center", jsonv.NewObject("x", s.Center.X, "y", s.Center.Y))
				if s.EvenOdd {
					o.Set("fillRule", "evenodd")
				}
				value = o
			}
		}
		var got *jsonv.Object
		if err != nil {
			got = jsonv.NewObject("ok", false, "error", err.Error())
		} else {
			got = jsonv.NewObject("ok", true, "value", value)
		}
		want, _ := c.Get("result")
		eq(t, "shape "+c.Str("name"), jsonv.Stringify(got, ""), jsonv.Stringify(want, ""))
	}
}
