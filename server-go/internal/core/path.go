package core

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf16"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/path.ts: strict SVG path parser, normalization to absolute
// M/L/C/Q/A/Z, exact bounds and serialization. Positions are UTF-16 indexes, like in JavaScript.

type Point struct{ X, Y float64 }

// Segment is one normalized path command. Cmd is M, L, C, Q, A or Z.
type Segment struct {
	Cmd             byte
	To, C1, C2, C   Point
	Rx, Ry, Rot     float64
	LargeArc, Sweep bool
}

// PathError carries the character position of a parse error.
type PathError struct {
	Msg      string
	Position int
}

func (e *PathError) Error() string { return e.Msg }

// MaxSegments protects the server and the canvas from huge inputs.
const MaxSegments = 10_000

var arity = map[byte]int{'M': 2, 'L': 2, 'H': 1, 'V': 1, 'C': 6, 'S': 4, 'Q': 4, 'T': 2, 'A': 7, 'Z': 0}

func isSpaceOrComma(u uint16) bool { return u == ',' || jsonv.IsSpace(rune(u)) }

func isLetter(u uint16) bool { return (u >= 'A' && u <= 'Z') || (u >= 'a' && u <= 'z') }

func isDigit(u uint16) bool { return u >= '0' && u <= '9' }

func upper(u uint16) byte {
	if u >= 'a' && u <= 'z' {
		return byte(u - 32)
	}
	return byte(u)
}

func charAt(d []uint16, i int) string { return string(utf16.Decode(d[i : i+1])) }

// matchNumber returns the length of /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/ at d[i:], or 0.
func matchNumber(d []uint16, i int) int {
	j := i
	if j < len(d) && (d[j] == '+' || d[j] == '-') {
		j++
	}
	if j < len(d) && isDigit(d[j]) {
		for j < len(d) && isDigit(d[j]) {
			j++
		}
		if j < len(d) && d[j] == '.' {
			j++
			for j < len(d) && isDigit(d[j]) {
				j++
			}
		}
	} else if j+1 < len(d) && d[j] == '.' && isDigit(d[j+1]) {
		j++
		for j < len(d) && isDigit(d[j]) {
			j++
		}
	} else {
		return 0
	}
	if j < len(d) && (d[j] == 'e' || d[j] == 'E') {
		k := j + 1
		if k < len(d) && (d[k] == '+' || d[k] == '-') {
			k++
		}
		if k < len(d) && isDigit(d[k]) {
			for k < len(d) && isDigit(d[k]) {
				k++
			}
			j = k
		}
	}
	return j - i
}

// ParsePath converts `d` into absolute segments.
func ParsePath(src string) ([]Segment, error) {
	d := utf16.Encode([]rune(src))
	var segs []Segment
	i := 0
	skip := func() {
		for i < len(d) && isSpaceOrComma(d[i]) {
			i++
		}
	}
	num := func() (float64, error) {
		skip()
		n := matchNumber(d, i)
		if n == 0 {
			found := " (end of text)"
			if i < len(d) {
				found = fmt.Sprintf(` (found "%s")`, charAt(d, i))
			}
			return 0, &PathError{fmt.Sprintf("number expected at position %d%s", i, found), i}
		}
		text := strings.TrimSuffix(string(utf16.Decode(d[i:i+n])), ".")
		i += n
		v, err := strconv.ParseFloat(text, 64)
		if err != nil {
			v = math.Inf(1)
		}
		if math.IsInf(v, 0) || math.IsNaN(v) || math.Abs(v) > 1e7 {
			return 0, &PathError{fmt.Sprintf("number out of range at position %d", i), i}
		}
		return v, nil
	}
	flag := func() (bool, error) {
		skip()
		if i >= len(d) || (d[i] != '0' && d[i] != '1') {
			return false, &PathError{fmt.Sprintf("arc flag (0 or 1) expected at position %d", i), i}
		}
		c := d[i]
		i++
		return c == '1', nil
	}

	var cur, start Point
	var lastCubic, lastQuad *Point
	var cmd uint16

	skip()
	if i < len(d) && d[i] != 'M' && d[i] != 'm' {
		return nil, &PathError{fmt.Sprintf("the path must start with M (position %d)", i), i}
	}
	for {
		skip()
		if i >= len(d) {
			break
		}
		c := d[i]
		if isLetter(c) {
			if _, ok := arity[upper(c)]; !ok {
				return nil, &PathError{fmt.Sprintf(`unknown command "%s" at position %d`, charAt(d, i), i), i}
			}
			cmd = c
			i++
		} else if cmd == 0 {
			return nil, &PathError{fmt.Sprintf("command expected at position %d", i), i}
		} else if cmd == 'Z' || cmd == 'z' {
			return nil, &PathError{fmt.Sprintf("numbers after Z at position %d", i), i}
		}
		abs := cmd >= 'A' && cmd <= 'Z'
		up := upper(cmd)
		ox, oy := 0.0, 0.0
		if !abs {
			ox, oy = cur.X, cur.Y
		}
		pt := func() (Point, error) {
			x, err := num()
			if err != nil {
				return Point{}, err
			}
			y, err := num()
			if err != nil {
				return Point{}, err
			}
			return Point{x + ox, y + oy}, nil
		}
		var seg Segment
		var err error
		switch up {
		case 'M':
			var to Point
			if to, err = pt(); err != nil {
				return nil, err
			}
			seg = Segment{Cmd: 'M', To: to}
			start = to
			if abs {
				cmd = 'L'
			} else {
				cmd = 'l'
			}
		case 'L':
			var to Point
			if to, err = pt(); err != nil {
				return nil, err
			}
			seg = Segment{Cmd: 'L', To: to}
		case 'H':
			var x float64
			if x, err = num(); err != nil {
				return nil, err
			}
			seg = Segment{Cmd: 'L', To: Point{x + ox, cur.Y}}
		case 'V':
			var y float64
			if y, err = num(); err != nil {
				return nil, err
			}
			seg = Segment{Cmd: 'L', To: Point{cur.X, y + oy}}
		case 'C':
			var c1, c2, to Point
			if c1, err = pt(); err != nil {
				return nil, err
			}
			if c2, err = pt(); err != nil {
				return nil, err
			}
			if to, err = pt(); err != nil {
				return nil, err
			}
			seg = Segment{Cmd: 'C', C1: c1, C2: c2, To: to}
		case 'S':
			c1 := cur
			if lastCubic != nil {
				c1 = Point{2*cur.X - lastCubic.X, 2*cur.Y - lastCubic.Y}
			}
			var c2, to Point
			if c2, err = pt(); err != nil {
				return nil, err
			}
			if to, err = pt(); err != nil {
				return nil, err
			}
			seg = Segment{Cmd: 'C', C1: c1, C2: c2, To: to}
		case 'Q':
			var cc, to Point
			if cc, err = pt(); err != nil {
				return nil, err
			}
			if to, err = pt(); err != nil {
				return nil, err
			}
			seg = Segment{Cmd: 'Q', C: cc, To: to}
		case 'T':
			cc := cur
			if lastQuad != nil {
				cc = Point{2*cur.X - lastQuad.X, 2*cur.Y - lastQuad.Y}
			}
			var to Point
			if to, err = pt(); err != nil {
				return nil, err
			}
			seg = Segment{Cmd: 'Q', C: cc, To: to}
		case 'A':
			var rx, ry, rot float64
			var large, sweep bool
			if rx, err = num(); err != nil {
				return nil, err
			}
			if ry, err = num(); err != nil {
				return nil, err
			}
			if rot, err = num(); err != nil {
				return nil, err
			}
			if large, err = flag(); err != nil {
				return nil, err
			}
			if sweep, err = flag(); err != nil {
				return nil, err
			}
			var to Point
			if to, err = pt(); err != nil {
				return nil, err
			}
			seg = Segment{Cmd: 'A', Rx: math.Abs(rx), Ry: math.Abs(ry), Rot: rot, LargeArc: large, Sweep: sweep, To: to}
		default:
			seg = Segment{Cmd: 'Z'}
		}
		lastCubic, lastQuad = nil, nil
		if seg.Cmd == 'C' {
			p := seg.C2
			lastCubic = &p
		}
		if seg.Cmd == 'Q' {
			p := seg.C
			lastQuad = &p
		}
		if seg.Cmd == 'Z' {
			cur = start
		} else {
			cur = seg.To
		}
		segs = append(segs, seg)
		if len(segs) > MaxSegments {
			return nil, &PathError{fmt.Sprintf("path with more than %d segments", MaxSegments), i}
		}
	}
	if len(segs) == 0 {
		return nil, &PathError{"empty path", 0}
	}
	return segs, nil
}

// PathErrorMessage validates d and returns the error message, or "".
func PathErrorMessage(d string) string {
	if _, err := ParsePath(d); err != nil {
		return err.Error()
	}
	return ""
}

func r2(n float64) string {
	v := jsonv.Round(n*100) / 100
	if v == 0 {
		return "0"
	}
	return jsonv.FormatNumber(v)
}

func p2(pt Point) string { return r2(pt.X) + " " + r2(pt.Y) }

// SerializePath writes absolute segments as `d` with 2 decimals.
func SerializePath(segs []Segment) string {
	out := make([]string, len(segs))
	for i, s := range segs {
		switch s.Cmd {
		case 'M', 'L':
			out[i] = string(s.Cmd) + p2(s.To)
		case 'C':
			out[i] = "C" + p2(s.C1) + " " + p2(s.C2) + " " + p2(s.To)
		case 'Q':
			out[i] = "Q" + p2(s.C) + " " + p2(s.To)
		case 'A':
			b := func(v bool) string {
				if v {
					return "1"
				}
				return "0"
			}
			out[i] = fmt.Sprintf("A%s %s %s %s %s %s", r2(s.Rx), r2(s.Ry), r2(s.Rot), b(s.LargeArc), b(s.Sweep), p2(s.To))
		default:
			out[i] = "Z"
		}
	}
	return strings.Join(out, " ")
}

func unitRoots(a, b, c float64) []float64 {
	var out []float64
	keep := func(t float64) {
		if t > 0 && t < 1 {
			out = append(out, t)
		}
	}
	if math.Abs(a) < 1e-12 {
		if math.Abs(b) < 1e-12 {
			return nil
		}
		keep(-c / b)
		return out
	}
	disc := b*b - 4*a*c
	if disc < 0 {
		return nil
	}
	s := math.Sqrt(disc)
	keep((-b + s) / (2 * a))
	keep((-b - s) / (2 * a))
	return out
}

func arcPoints(from Point, s Segment) []Point {
	rx, ry := s.Rx, s.Ry
	if rx == 0 || ry == 0 || (from.X == s.To.X && from.Y == s.To.Y) {
		return []Point{s.To}
	}
	phi := (s.Rot * math.Pi) / 180
	cos, sin := math.Cos(phi), math.Sin(phi)
	dx := (from.X - s.To.X) / 2
	dy := (from.Y - s.To.Y) / 2
	x1 := cos*dx + sin*dy
	y1 := -sin*dx + cos*dy
	lambda := (x1*x1)/(rx*rx) + (y1*y1)/(ry*ry)
	if lambda > 1 {
		rx *= math.Sqrt(lambda)
		ry *= math.Sqrt(lambda)
	}
	num := rx*rx*ry*ry - rx*rx*y1*y1 - ry*ry*x1*x1
	den := rx*rx*y1*y1 + ry*ry*x1*x1
	sign := 1.0
	if s.LargeArc == s.Sweep {
		sign = -1
	}
	k := sign * math.Sqrt(math.Max(0, num/den))
	cx1 := (k * rx * y1) / ry
	cy1 := (-k * ry * x1) / rx
	cx := cos*cx1 - sin*cy1 + (from.X+s.To.X)/2
	cy := sin*cx1 + cos*cy1 + (from.Y+s.To.Y)/2
	angle := func(ux, uy, vx, vy float64) float64 { return math.Atan2(ux*vy-uy*vx, ux*vx+uy*vy) }
	t1 := angle(1, 0, (x1-cx1)/rx, (y1-cy1)/ry)
	dt := angle((x1-cx1)/rx, (y1-cy1)/ry, (-x1-cx1)/rx, (-y1-cy1)/ry)
	if !s.Sweep && dt > 0 {
		dt -= 2 * math.Pi
	}
	if s.Sweep && dt < 0 {
		dt += 2 * math.Pi
	}
	at := func(t float64) Point {
		return Point{
			cx + rx*math.Cos(t)*cos - ry*math.Sin(t)*sin,
			cy + rx*math.Cos(t)*sin + ry*math.Sin(t)*cos,
		}
	}
	n := int(math.Max(8, math.Ceil((math.Abs(dt)/(math.Pi/2))*16)))
	out := make([]Point, n+1)
	for j := 0; j <= n; j++ {
		out[j] = at(t1 + (dt*float64(j))/float64(n))
	}
	return out
}

// Bounds is an axis-aligned box.
type Bounds struct{ X, Y, Width, Height float64 }

func cube(v float64) float64 { return math.Pow(v, 3) }

// PathBounds is the exact box of the geometry (not of the control points).
func PathBounds(segs []Segment) Bounds {
	minX, minY := math.Inf(1), math.Inf(1)
	maxX, maxY := math.Inf(-1), math.Inf(-1)
	add := func(p Point) {
		minX = math.Min(minX, p.X)
		minY = math.Min(minY, p.Y)
		maxX = math.Max(maxX, p.X)
		maxY = math.Max(maxY, p.Y)
	}
	var cur, start Point
	for _, s := range segs {
		switch s.Cmd {
		case 'M':
			start = s.To
			add(s.To)
		case 'L':
			add(s.To)
		case 'C':
			add(s.To)
			for axis := range 2 {
				g := func(p Point) float64 {
					if axis == 0 {
						return p.X
					}
					return p.Y
				}
				p0, p1, p2, p3 := g(cur), g(s.C1), g(s.C2), g(s.To)
				a := -p0 + 3*p1 - 3*p2 + p3
				b := 2 * (p0 - 2*p1 + p2)
				c := p1 - p0
				for _, t := range unitRoots(3*a, 3*b, 3*c) {
					mt := 1 - t
					add(Point{
						cube(mt)*cur.X + 3*mt*mt*t*s.C1.X + 3*mt*t*t*s.C2.X + cube(t)*s.To.X,
						cube(mt)*cur.Y + 3*mt*mt*t*s.C1.Y + 3*mt*t*t*s.C2.Y + cube(t)*s.To.Y,
					})
				}
			}
		case 'Q':
			add(s.To)
			for axis := range 2 {
				var c0, cc, c2 float64
				if axis == 0 {
					c0, cc, c2 = cur.X, s.C.X, s.To.X
				} else {
					c0, cc, c2 = cur.Y, s.C.Y, s.To.Y
				}
				den := c0 - 2*cc + c2
				if math.Abs(den) < 1e-12 {
					continue
				}
				t := (c0 - cc) / den
				if t <= 0 || t >= 1 {
					continue
				}
				mt := 1 - t
				add(Point{mt*mt*cur.X + 2*mt*t*s.C.X + t*t*s.To.X, mt*mt*cur.Y + 2*mt*t*s.C.Y + t*t*s.To.Y})
			}
		case 'A':
			for _, p := range arcPoints(cur, s) {
				add(p)
			}
		}
		if s.Cmd == 'Z' {
			cur = start
		} else {
			cur = s.To
		}
	}
	if math.IsInf(minX, 1) {
		return Bounds{}
	}
	return Bounds{minX, minY, maxX - minX, maxY - minY}
}

// PathOrigin is the offset from the node origin (0,0) to the drawing's top-left.
func PathOrigin(segs []Segment) Point {
	b := PathBounds(segs)
	return Point{b.X, b.Y}
}

// NormalizePath moves the drawing to (0,0) and returns the previous origin (add to the node's x/y).
func NormalizePath(segs []Segment) (moved []Segment, origin Point, bounds Bounds) {
	origin = PathOrigin(segs)
	moved = TranslatePath(segs, -origin.X, -origin.Y)
	return moved, origin, PathBounds(moved)
}
