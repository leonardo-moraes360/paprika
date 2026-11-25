package core

import "math"

type PathAnchor struct {
	X, Y float64
	In   *Point
	Out  *Point
}

type Subpath struct {
	Anchors []PathAnchor
	Closed  bool
}

type AnchorRef struct {
	Sub   int
	Index int
}

type PathEditNode struct {
	X, Y    float64
	ViewBox bool
}

type EditedPath struct {
	D             string
	X, Y          float64
	Width, Height float64
	HasXY         bool
	HasSize       bool
}

func pathSame(a, b Point) bool {
	return math.Abs(a.X-b.X) < 1e-9 && math.Abs(a.Y-b.Y) < 1e-9
}

func anchorPoint(a PathAnchor) Point { return Point{a.X, a.Y} }

func PathToSubpaths(segs []Segment) []Subpath {
	var subs []Subpath
	cur := -1
	var start, at Point
	begin := func(p Point) {
		subs = append(subs, Subpath{Anchors: []PathAnchor{{X: p.X, Y: p.Y}}})
		cur = len(subs) - 1
		start = p
		at = p
	}
	open := func() *Subpath {
		if cur < 0 || subs[cur].Closed {
			begin(start)
		}
		return &subs[cur]
	}
	curve := func(c1, c2, to Point) {
		s := open()
		prev := &s.Anchors[len(s.Anchors)-1]
		if !pathSame(c1, anchorPoint(*prev)) {
			p := c1
			prev.Out = &p
		}
		a := PathAnchor{X: to.X, Y: to.Y}
		if !pathSame(c2, to) {
			p := c2
			a.In = &p
		}
		s.Anchors = append(s.Anchors, a)
		at = to
	}
	for _, seg := range segs {
		switch seg.Cmd {
		case 'M':
			begin(seg.To)
		case 'L':
			s := open()
			s.Anchors = append(s.Anchors, PathAnchor{X: seg.To.X, Y: seg.To.Y})
			at = seg.To
		case 'C':
			curve(seg.C1, seg.C2, seg.To)
		case 'Q':
			from := at
			curve(
				Point{from.X + (2.0/3.0)*(seg.C.X-from.X), from.Y + (2.0/3.0)*(seg.C.Y-from.Y)},
				Point{seg.To.X + (2.0/3.0)*(seg.C.X-seg.To.X), seg.To.Y + (2.0/3.0)*(seg.C.Y-seg.To.Y)},
				seg.To,
			)
		case 'A':
			from := at
			open()
			for _, c := range ArcToCubics(from, seg) {
				if c.Cmd == 'C' {
					curve(c.C1, c.C2, c.To)
				} else if c.Cmd == 'L' {
					s := &subs[cur]
					s.Anchors = append(s.Anchors, PathAnchor{X: c.To.X, Y: c.To.Y})
					at = c.To
				}
			}
		case 'Z':
			if cur < 0 || subs[cur].Closed {
				break
			}
			s := &subs[cur]
			first := &s.Anchors[0]
			last := &s.Anchors[len(s.Anchors)-1]
			if len(s.Anchors) > 1 && pathSame(anchorPoint(*first), anchorPoint(*last)) {
				if last.In != nil {
					p := *last.In
					first.In = &p
				}
				s.Anchors = s.Anchors[:len(s.Anchors)-1]
			}
			s.Closed = true
			at = start
		}
	}
	return subs
}

func SubpathsToPath(subs []Subpath) []Segment {
	var segs []Segment
	link := func(a, b PathAnchor) {
		if a.Out != nil || b.In != nil {
			c1 := anchorPoint(a)
			if a.Out != nil {
				c1 = *a.Out
			}
			c2 := anchorPoint(b)
			if b.In != nil {
				c2 = *b.In
			}
			segs = append(segs, Segment{Cmd: 'C', C1: c1, C2: c2, To: anchorPoint(b)})
			return
		}
		segs = append(segs, Segment{Cmd: 'L', To: anchorPoint(b)})
	}
	for _, s := range subs {
		if len(s.Anchors) == 0 {
			continue
		}
		segs = append(segs, Segment{Cmd: 'M', To: anchorPoint(s.Anchors[0])})
		for k := 1; k < len(s.Anchors); k++ {
			link(s.Anchors[k-1], s.Anchors[k])
		}
		if s.Closed && len(s.Anchors) > 1 {
			first := s.Anchors[0]
			last := s.Anchors[len(s.Anchors)-1]
			if last.Out != nil || first.In != nil {
				link(last, first)
			}
			segs = append(segs, Segment{Cmd: 'Z'})
		}
	}
	return segs
}

func cloneSubs(subs []Subpath) []Subpath {
	out := make([]Subpath, len(subs))
	for i, s := range subs {
		anchors := make([]PathAnchor, len(s.Anchors))
		for j, a := range s.Anchors {
			anchors[j] = a
			if a.In != nil {
				p := *a.In
				anchors[j].In = &p
			}
			if a.Out != nil {
				p := *a.Out
				anchors[j].Out = &p
			}
		}
		out[i] = Subpath{Closed: s.Closed, Anchors: anchors}
	}
	return out
}

func subOf(subs []Subpath, ref AnchorRef) *Subpath {
	if ref.Sub < 0 || ref.Index < 0 || ref.Sub >= len(subs) {
		return nil
	}
	return &subs[ref.Sub]
}

func anchorAt(s *Subpath, index int) *PathAnchor {
	if s == nil || index < 0 || index >= len(s.Anchors) {
		return nil
	}
	return &s.Anchors[index]
}

func AnchorByFlatIndex(subs []Subpath, index int) (AnchorRef, bool) {
	if index < 0 {
		return AnchorRef{}, false
	}
	base := 0
	for sub := range subs {
		n := len(subs[sub].Anchors)
		if index < base+n {
			return AnchorRef{Sub: sub, Index: index - base}, true
		}
		base += n
	}
	return AnchorRef{}, false
}

func MoveAnchor(subs []Subpath, ref AnchorRef, to Point) []Subpath {
	out := cloneSubs(subs)
	a := anchorAt(subOf(out, ref), ref.Index)
	if a == nil {
		return out
	}
	dx := to.X - a.X
	dy := to.Y - a.Y
	a.X = to.X
	a.Y = to.Y
	if a.In != nil {
		a.In = &Point{a.In.X + dx, a.In.Y + dy}
	}
	if a.Out != nil {
		a.Out = &Point{a.Out.X + dx, a.Out.Y + dy}
	}
	return out
}

func MoveHandle(subs []Subpath, ref AnchorRef, side string, to Point, mirror bool) []Subpath {
	out := cloneSubs(subs)
	a := anchorAt(subOf(out, ref), ref.Index)
	if a == nil || (side != "in" && side != "out") {
		return out
	}
	moved := Point{to.X, to.Y}
	if side == "in" {
		a.In = &moved
	} else {
		a.Out = &moved
	}
	var o *Point
	if side == "in" {
		o = a.Out
	} else {
		o = a.In
	}
	if mirror && o != nil {
		length := math.Hypot(o.X-a.X, o.Y-a.Y)
		dx := a.X - to.X
		dy := a.Y - to.Y
		d := math.Hypot(dx, dy)
		if d > 1e-9 {
			mirrored := Point{a.X + (dx/d)*length, a.Y + (dy/d)*length}
			if side == "in" {
				a.Out = &mirrored
			} else {
				a.In = &mirrored
			}
		}
	}
	return out
}

func PathEditProps(node PathEditNode, subs []Subpath, moveBox bool) *EditedPath {
	segs := SubpathsToPath(subs)
	if len(segs) == 0 {
		return nil
	}
	if node.ViewBox {
		return &EditedPath{D: SerializePath(segs)}
	}
	b := PathBounds(segs)
	dx := math.Floor(b.X)
	dy := math.Floor(b.Y)
	out := &EditedPath{
		D:       SerializePath(TranslatePath(segs, -dx, -dy)),
		Width:   math.Max(1, math.Ceil(b.X+b.Width)-dx),
		Height:  math.Max(1, math.Ceil(b.Y+b.Height)-dy),
		HasSize: true,
	}
	if moveBox {
		out.X = node.X + dx
		out.Y = node.Y + dy
		out.HasXY = true
	}
	return out
}
