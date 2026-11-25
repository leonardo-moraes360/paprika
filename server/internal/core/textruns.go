package core

import (
	"unicode/utf16"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

type TextPiece struct {
	Text string
	Run  *jsonv.Object
}

func utf16Units(s string) []uint16 {
	return utf16.Encode([]rune(s))
}

func slice16(s string, start, end int) string {
	u := utf16Units(s)
	if start < 0 {
		start = 0
	}
	if end > len(u) {
		end = len(u)
	}
	if start >= end {
		return ""
	}
	return string(utf16.Decode(u[start:end]))
}

func TextPieces(text string, runs []any) []TextPiece {
	var typed []*jsonv.Object
	for _, item := range runs {
		if o, ok := item.(*jsonv.Object); ok {
			typed = append(typed, o)
		}
	}
	if len(typed) == 0 {
		return []TextPiece{{Text: text}}
	}
	var out []TextPiece
	cursor := 0
	total := len(utf16Units(text))
	for _, run := range typed {
		start := int(run.Num("start"))
		end := int(run.Num("end"))
		if start > cursor {
			if gap := slice16(text, cursor, start); gap != "" {
				out = append(out, TextPiece{Text: gap})
			}
		}
		if end > start {
			if body := slice16(text, start, end); body != "" {
				out = append(out, TextPiece{Text: body, Run: run})
			}
		}
		if end > cursor {
			cursor = end
		}
	}
	if tail := slice16(text, cursor, total); tail != "" {
		out = append(out, TextPiece{Text: tail})
	}
	if len(out) == 0 {
		return []TextPiece{{Text: text}}
	}
	return out
}

func PiecesInRange(text string, absStart int, runs []any) []TextPiece {
	if len(runs) == 0 {
		if text == "" {
			return nil
		}
		return []TextPiece{{Text: text}}
	}
	end := absStart + len(utf16Units(text))
	var clipped []any
	for _, item := range runs {
		o, ok := item.(*jsonv.Object)
		if !ok {
			continue
		}
		s := int(o.Num("start"))
		e := int(o.Num("end"))
		if e <= absStart || s >= end {
			continue
		}
		if s < absStart {
			s = absStart
		}
		if e > end {
			e = end
		}
		c := o.Spread()
		c.Set("start", float64(s-absStart))
		c.Set("end", float64(e-absStart))
		clipped = append(clipped, c)
	}
	return TextPieces(text, clipped)
}
