package core

import (
	"math"
	"regexp"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

func snap(n float64, digits int) float64 {
	p := math.Pow(10, float64(digits))
	return jsonv.Round(n*p) / p
}

func clamp(n, min, max float64) float64 {
	return math.Min(max, math.Max(min, n))
}

func linSrgb(c float64) float64 {
	abs := math.Abs(c)
	if abs <= 0.04045 {
		return c / 12.92
	}
	return math.Copysign(math.Pow((abs+0.055)/1.055, 2.4), c)
}

func gamSrgb(c float64) float64 {
	abs := math.Abs(c)
	if abs > 0.0031308 {
		return math.Copysign(1.055*math.Pow(abs, 1/2.4)-0.055, c)
	}
	return 12.92 * c
}

func matVec(m [3][3]float64, v [3]float64) [3]float64 {
	return [3]float64{
		m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
		m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
		m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2],
	}
}

var p3ToSrgb = [3][3]float64{
	{1.22474525619, -0.224904359131, 0},
	{-0.0420579219923, 1.04208100715, 0},
	{-0.0196422795874, -0.0786549166058, 1.09853719388},
}

var srgbToP3 = [3][3]float64{
	{0.82259273464, 0.177533953915, 0},
	{0.0331996005222, 0.966783523424, 0},
	{0.0170853488705, 0.0723957406011, 0.91030147619},
}

func rgb8(r, g, b, a float64) RGBA {
	ch := func(c float64) float64 { return snap(clamp(gamSrgb(c), 0, 1)*255, 0) }
	return RGBA{ch(r), ch(g), ch(b), snap(clamp(a, 0, 1), 4)}
}

func linOf(c RGBA) [3]float64 {
	return [3]float64{linSrgb(c.R / 255), linSrgb(c.G / 255), linSrgb(c.B / 255)}
}

func oklchToRgb(l, c, h float64) (r, g, b float64) {
	rad := h * math.Pi / 180
	a := c * math.Cos(rad)
	bb := c * math.Sin(rad)
	l_ := l + 0.3963377774*a + 0.2158037573*bb
	m_ := l - 0.1055613458*a - 0.0638541728*bb
	s_ := l - 0.0894841775*a - 1.291485548*bb
	ll, mm, ss := l_*l_*l_, m_*m_*m_, s_*s_*s_
	out := rgb8(
		4.0767416621*ll-3.3077115913*mm+0.2309699292*ss,
		-1.2684380046*ll+2.6097574011*mm-0.3413193965*ss,
		-0.0041960863*ll-0.7034186147*mm+1.707614701*ss,
		1,
	)
	return out.R, out.G, out.B
}

func rgbToOklch(r, g, b float64) (l, c, h float64) {
	lin := linOf(RGBA{r, g, b, 1})
	ll := math.Cbrt(0.4122214708*lin[0] + 0.5363325363*lin[1] + 0.0514459929*lin[2])
	m := math.Cbrt(0.2119034982*lin[0] + 0.6806995451*lin[1] + 0.1073969566*lin[2])
	s := math.Cbrt(0.0883024619*lin[0] + 0.2817188376*lin[1] + 0.6299787005*lin[2])
	L := 0.2104542553*ll + 0.793617785*m - 0.0040720468*s
	A := 1.9779984951*ll - 2.428592205*m + 0.4505937099*s
	Bb := 0.0259040371*ll + 0.7827717662*m - 0.808675766*s
	h = math.Atan2(Bb, A) * 180 / math.Pi
	if h < 0 {
		h += 360
	}
	return L, math.Hypot(A, Bb), h
}

func splitDepth(s, sep string) (string, string, bool) {
	depth := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '(':
			depth++
		case ')':
			depth--
		default:
			if depth == 0 && string(s[i]) == sep {
				return s[:i], s[i+1:], true
			}
		}
	}
	return "", "", false
}

var reNum = regexp.MustCompile(`^-?\d*\.?\d+$`)

func parseNum(s string) (float64, bool) {
	t := jsonv.Trim(s)
	if !reNum.MatchString(t) {
		return 0, false
	}
	n := jsonv.ParseFloat(t)
	if math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, false
	}
	return n, true
}

func component(s string, scale float64) (float64, bool) {
	t := jsonv.Trim(s)
	if t == "none" {
		return 0, true
	}
	if strings.HasSuffix(t, "%") {
		n, ok := parseNum(t[:len(t)-1])
		if !ok {
			return 0, false
		}
		return (n / 100) * scale, true
	}
	return parseNum(t)
}

func alphaOf(s string, present bool) (float64, bool) {
	if !present {
		return 1, true
	}
	t := jsonv.Trim(s)
	if t == "none" {
		return 0, true
	}
	if strings.HasSuffix(t, "%") {
		n, ok := parseNum(t[:len(t)-1])
		if !ok {
			return 0, false
		}
		return n / 100, true
	}
	return parseNum(t)
}

var reAngle = regexp.MustCompile(`^(-?\d*\.?\d+)(deg|turn|rad|grad)?$`)

func angleOf(s string) (float64, bool) {
	t := jsonv.Trim(s)
	if t == "none" {
		return 0, true
	}
	m := reAngle.FindStringSubmatch(t)
	if m == nil {
		return 0, false
	}
	n, ok := parseNum(m[1])
	if !ok {
		return 0, false
	}
	switch m[2] {
	case "turn":
		return n * 360, true
	case "rad":
		return n * 180 / math.Pi, true
	case "grad":
		return n * 0.9, true
	default:
		return n, true
	}
}

func readOklch(input string) (l, c, h, a float64, ok bool) {
	s := strings.ToLower(jsonv.Trim(input))
	if !strings.HasPrefix(s, "oklch(") || !strings.HasSuffix(s, ")") {
		return 0, 0, 0, 0, false
	}
	body := jsonv.Trim(s[6 : len(s)-1])
	if strings.Contains(body, "from") {
		return 0, 0, 0, 0, false
	}
	coords := body
	alpha := ""
	hasAlpha := false
	if left, right, cut := splitDepth(body, "/"); cut {
		coords = jsonv.Trim(left)
		alpha = right
		hasAlpha = true
	}
	parts := strings.FieldsFunc(coords, func(r rune) bool {
		return r == ' ' || r == ',' || r == '\t' || r == '\n' || r == '\r' || r == '\v' || r == '\f'
	})
	if len(parts) < 3 {
		return 0, 0, 0, 0, false
	}
	l, ok = component(parts[0], 1)
	if !ok {
		return 0, 0, 0, 0, false
	}
	c, ok = component(parts[1], 0.4)
	if !ok {
		return 0, 0, 0, 0, false
	}
	h, ok = angleOf(parts[2])
	if !ok {
		return 0, 0, 0, 0, false
	}
	a, ok = alphaOf(alpha, hasAlpha)
	if !ok {
		return 0, 0, 0, 0, false
	}
	return l, c, h, snap(clamp(a, 0, 1), 4), true
}

func parseOklch(s string) (RGBA, bool) {
	l, c, h, a, ok := readOklch(s)
	if !ok {
		return RGBA{}, false
	}
	r, g, b := oklchToRgb(clamp(l, 0, 1), math.Max(0, c), h)
	return RGBA{r, g, b, a}, true
}

var reColorFn = regexp.MustCompile(`^color\(\s*(display-p3|srgb)\s+([^)]*)\)$`)

func parseColorFn(s string) (RGBA, bool) {
	m := reColorFn.FindStringSubmatch(s)
	if m == nil {
		return RGBA{}, false
	}
	body := jsonv.Trim(m[2])
	coords := body
	alpha := ""
	hasAlpha := false
	if left, right, cut := splitDepth(body, "/"); cut {
		coords = jsonv.Trim(left)
		alpha = right
		hasAlpha = true
	}
	parts := strings.FieldsFunc(coords, func(r rune) bool {
		return r == ' ' || r == ',' || r == '\t' || r == '\n' || r == '\r' || r == '\v' || r == '\f'
	})
	if len(parts) < 3 {
		return RGBA{}, false
	}
	r, ok1 := component(parts[0], 1)
	g, ok2 := component(parts[1], 1)
	b, ok3 := component(parts[2], 1)
	a, ok4 := alphaOf(alpha, hasAlpha)
	if !ok1 || !ok2 || !ok3 || !ok4 {
		return RGBA{}, false
	}
	if m[1] == "srgb" {
		return rgb8(linSrgb(r), linSrgb(g), linSrgb(b), a), true
	}
	lin := matVec(p3ToSrgb, [3]float64{linSrgb(r), linSrgb(g), linSrgb(b)})
	return rgb8(lin[0], lin[1], lin[2], a), true
}

var rePct = regexp.MustCompile(`^\d*\.?\d+%$`)

func peelPercent(s string) (color string, pct float64, has bool) {
	t := jsonv.Trim(s)
	depth := 0
	last := -1
	for i := 0; i < len(t); i++ {
		switch t[i] {
		case '(':
			depth++
		case ')':
			depth--
		default:
			if depth == 0 && (t[i] == ' ' || t[i] == '\t' || t[i] == '\n' || t[i] == '\r' || t[i] == '\v' || t[i] == '\f') {
				last = i
			}
		}
	}
	if last < 0 {
		return t, 0, false
	}
	tail := jsonv.Trim(t[last+1:])
	if !rePct.MatchString(tail) {
		return t, 0, false
	}
	n, ok := parseNum(tail[:len(tail)-1])
	if !ok {
		return t, 0, false
	}
	return jsonv.Trim(t[:last]), n, true
}

func hueMix(h1, h2, t float64) float64 {
	d := h2 - h1
	if d > 180 {
		d -= 360
	}
	if d < -180 {
		d += 360
	}
	h := math.Mod(h1+d*t, 360)
	if h < 0 {
		h += 360
	}
	return h
}

func mixSrgb(a, b RGBA, t float64) RGBA {
	wa := (1 - t) * a.A
	wb := t * b.A
	w := wa + wb
	if w == 0 {
		return RGBA{}
	}
	return RGBA{
		snap((a.R*wa+b.R*wb)/w, 0),
		snap((a.G*wa+b.G*wb)/w, 0),
		snap((a.B*wa+b.B*wb)/w, 0),
		snap(w, 4),
	}
}

func mixOklch(a, b RGBA, t float64) RGBA {
	al, ac, ah := rgbToOklch(a.R, a.G, a.B)
	bl, bc, bh := rgbToOklch(b.R, b.G, b.B)
	wa := (1 - t) * a.A
	wb := t * b.A
	w := wa + wb
	if w == 0 {
		return RGBA{}
	}
	l := (al*wa + bl*wb) / w
	c := (ac*wa + bc*wb) / w
	r, g, bch := oklchToRgb(clamp(l, 0, 1), math.Max(0, c), hueMix(ah, bh, wb/w))
	return RGBA{r, g, bch, snap(w, 4)}
}

func mixP3(a, b RGBA, t float64) RGBA {
	A := matVec(srgbToP3, linOf(a))
	B := matVec(srgbToP3, linOf(b))
	wa := (1 - t) * a.A
	wb := t * b.A
	w := wa + wb
	if w == 0 {
		return RGBA{}
	}
	p3 := [3]float64{(A[0]*wa + B[0]*wb) / w, (A[1]*wa + B[1]*wb) / w, (A[2]*wa + B[2]*wb) / w}
	lin := matVec(p3ToSrgb, p3)
	return rgb8(lin[0], lin[1], lin[2], w)
}

var reColorMix = regexp.MustCompile(`^color-mix\(\s*in\s+([a-z0-9-]+)\s*,\s*([\s\S]*)\)$`)

func parseColorMix(s string, parse func(string) (RGBA, bool)) (RGBA, bool) {
	m := reColorMix.FindStringSubmatch(s)
	if m == nil {
		return RGBA{}, false
	}
	space := m[1]
	if space != "srgb" && space != "oklch" && space != "display-p3" {
		return RGBA{}, false
	}
	left, right, cut := splitDepth(m[2], ",")
	if !cut {
		return RGBA{}, false
	}
	c1, p1, has1 := peelPercent(left)
	c2, p2, has2 := peelPercent(right)
	if !has1 && !has2 {
		p1, p2 = 50, 50
	} else if !has1 {
		p1 = 100 - p2
	} else if !has2 {
		p2 = 100 - p1
	}
	sum := p1 + p2
	if !(sum > 0) {
		return RGBA{}, false
	}
	t := p2 / sum
	a, ok1 := parse(c1)
	b, ok2 := parse(c2)
	if !ok1 || !ok2 {
		return RGBA{}, false
	}
	switch space {
	case "oklch":
		return mixOklch(a, b, t), true
	case "display-p3":
		return mixP3(a, b, t), true
	default:
		return mixSrgb(a, b, t), true
	}
}

func parseModernColor(input string, parse func(string) (RGBA, bool)) (RGBA, bool) {
	s := strings.ToLower(jsonv.Trim(input))
	switch {
	case strings.HasPrefix(s, "oklch("):
		return parseOklch(s)
	case strings.HasPrefix(s, "color("):
		return parseColorFn(s)
	case strings.HasPrefix(s, "color-mix("):
		return parseColorMix(s, parse)
	default:
		return RGBA{}, false
	}
}
