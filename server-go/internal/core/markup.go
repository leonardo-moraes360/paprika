package core

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
)

// Port of packages/core/src/markup.ts: a tolerant reader for pasted HTML and SVG.

// MarkupElement is an element; Children holds *MarkupElement or string.
type MarkupElement struct {
	Tag      string
	Attrs    map[string]string
	Children []any
}

// Attr returns an attribute and whether it is present.
func (e *MarkupElement) Attr(k string) (string, bool) {
	v, ok := e.Attrs[k]
	return v, ok
}

const (
	markupMaxChars    = 2_000_000
	markupMaxElements = 5_000
	markupMaxDepth    = 200
)

var (
	markupVoid = map[string]bool{"area": true, "base": true, "br": true, "col": true, "embed": true, "hr": true, "img": true, "input": true, "link": true, "meta": true, "source": true, "track": true, "wbr": true}
	markupRaw  = map[string]bool{"script": true, "style": true}
	entityRe   = regexp.MustCompile(`&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});`)
	namedEnt   = map[string]string{"amp": "&", "lt": "<", "gt": ">", "quot": `"`, "apos": "'", "nbsp": " "}
)

func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

// DecodeEntities decodes the common named and numeric character references.
func DecodeEntities(s string) string {
	return entityRe.ReplaceAllStringFunc(s, func(m string) string {
		body := m[1 : len(m)-1]
		if body[0] == '#' {
			var code int64
			if body[1] == 'x' || body[1] == 'X' {
				code, _ = strconv.ParseInt(body[2:], 16, 64)
			} else {
				code, _ = strconv.ParseInt(body[1:], 10, 64)
			}
			if code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) {
				return string(rune(code))
			}
			return m
		}
		if v, ok := namedEnt[body]; ok {
			return v
		}
		return m
	})
}

func mkSpace(c byte) bool { return c == ' ' || c == '\n' || c == '\t' || c == '\r' || c == '\f' }

func mkNameChar(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == ':' || c == '.' || c == '-'
}

func indexOfLower(src, needle string, from int) int {
outer:
	for k := from; k+len(needle) <= len(src); k++ {
		for m := 0; m < len(needle); m++ {
			c := src[k+m]
			if c >= 'A' && c <= 'Z' {
				c += 32
			}
			if c != needle[m] {
				continue outer
			}
		}
		return k
	}
	return -1
}

func indexFrom(s, sub string, from int) int {
	if from > len(s) {
		return -1
	}
	i := strings.Index(s[from:], sub)
	if i < 0 {
		return -1
	}
	return from + i
}

// ParseMarkup reads markup into a "#root" element.
func ParseMarkup(src string) (*MarkupElement, error) {
	if jsonv.Len16(src) > markupMaxChars {
		return nil, fmt.Errorf("marcação grande demais (máx. %d caracteres)", markupMaxChars)
	}
	root := &MarkupElement{Tag: "#root", Attrs: map[string]string{}}
	stack := []*MarkupElement{root}
	count := 0
	i := 0
	top := func() *MarkupElement { return stack[len(stack)-1] }
	text := func(s string) {
		if s == "" {
			return
		}
		t := top()
		if n := len(t.Children); n > 0 {
			if last, ok := t.Children[n-1].(string); ok {
				t.Children[n-1] = last + s
				return
			}
		}
		t.Children = append(t.Children, s)
	}
	at := func(k int) byte {
		if k < len(src) {
			return src[k]
		}
		return 0
	}
	for i < len(src) {
		lt := indexFrom(src, "<", i)
		if lt < 0 {
			text(DecodeEntities(src[i:]))
			break
		}
		text(DecodeEntities(src[i:lt]))
		i = lt
		if strings.HasPrefix(src[i:], "<!--") {
			end := indexFrom(src, "-->", i+4)
			if end < 0 {
				i = len(src)
			} else {
				i = end + 3
			}
			continue
		}
		if strings.HasPrefix(src[i:], "<![CDATA[") {
			end := indexFrom(src, "]]>", i+9)
			if end < 0 {
				text(src[i+9:])
				i = len(src)
			} else {
				text(src[i+9 : end])
				i = end + 3
			}
			continue
		}
		if at(i+1) == '!' || at(i+1) == '?' {
			end := indexFrom(src, ">", i)
			if end < 0 {
				i = len(src)
			} else {
				i = end + 1
			}
			continue
		}
		if at(i+1) == '/' {
			j := i + 2
			for j < len(src) && mkNameChar(src[j]) {
				j++
			}
			name := asciiLower(src[i+2 : j])
			end := indexFrom(src, ">", j)
			if end < 0 {
				i = len(src)
			} else {
				i = end + 1
			}
			for k := len(stack) - 1; k > 0; k-- {
				if stack[k].Tag == name {
					stack = stack[:k]
					break
				}
			}
			continue
		}
		j := i + 1
		for j < len(src) && mkNameChar(src[j]) {
			j++
		}
		if j == i+1 {
			text("<")
			i++
			continue
		}
		el := &MarkupElement{Tag: asciiLower(src[i+1 : j]), Attrs: map[string]string{}}
		selfClose := false
		for j < len(src) {
			for j < len(src) && mkSpace(src[j]) {
				j++
			}
			if at(j) == '>' {
				j++
				break
			}
			if at(j) == '/' && at(j+1) == '>' {
				selfClose = true
				j += 2
				break
			}
			k := j
			for k < len(src) && !mkSpace(src[k]) && src[k] != '=' && src[k] != '>' && !(src[k] == '/' && at(k+1) == '>') {
				k++
			}
			if k == j {
				j++
				continue
			}
			name := asciiLower(src[j:k])
			j = k
			for j < len(src) && mkSpace(src[j]) {
				j++
			}
			value := ""
			if at(j) == '=' {
				j++
				for j < len(src) && mkSpace(src[j]) {
					j++
				}
				q := at(j)
				if q == '"' || q == '\'' {
					end := indexFrom(src, string(q), j+1)
					if end < 0 {
						value = src[j+1:]
						j = len(src)
					} else {
						value = src[j+1 : end]
						j = end + 1
					}
				} else {
					e := j
					for e < len(src) && !mkSpace(src[e]) && src[e] != '>' {
						e++
					}
					value = src[j:e]
					j = e
				}
			}
			if _, dup := el.Attrs[name]; !dup {
				el.Attrs[name] = DecodeEntities(value)
			}
		}
		i = j
		count++
		if count > markupMaxElements {
			return nil, fmt.Errorf("marcação com mais de %d elementos", markupMaxElements)
		}
		t := top()
		t.Children = append(t.Children, el)
		if markupRaw[el.Tag] {
			closeAt := indexOfLower(src, "</"+el.Tag, i)
			if closeAt < 0 {
				el.Children = append(el.Children, src[i:])
				i = len(src)
			} else {
				el.Children = append(el.Children, src[i:closeAt])
				end := indexFrom(src, ">", closeAt)
				if end < 0 {
					i = len(src)
				} else {
					i = end + 1
				}
			}
			continue
		}
		if selfClose || markupVoid[el.Tag] {
			continue
		}
		if len(stack) > markupMaxDepth {
			return nil, fmt.Errorf("marcação com mais de %d níveis", markupMaxDepth)
		}
		stack = append(stack, el)
	}
	return root, nil
}

// Elements returns the element children (no text).
func (e *MarkupElement) Elements() []*MarkupElement {
	var out []*MarkupElement
	for _, c := range e.Children {
		if el, ok := c.(*MarkupElement); ok {
			out = append(out, el)
		}
	}
	return out
}

// FindElement is a depth-first search for the first descendant with the tag.
func FindElement(e *MarkupElement, tag string) *MarkupElement {
	for _, c := range e.Elements() {
		if c.Tag == tag {
			return c
		}
		if hit := FindElement(c, tag); hit != nil {
			return hit
		}
	}
	return nil
}

// TextContent concatenates descendant text; <br> becomes a line break.
func TextContent(e *MarkupElement) string {
	var b strings.Builder
	for _, c := range e.Children {
		switch v := c.(type) {
		case string:
			b.WriteString(v)
		case *MarkupElement:
			if v.Tag == "br" {
				b.WriteString("\n")
			} else if !markupRaw[v.Tag] {
				b.WriteString(TextContent(v))
			}
		}
	}
	return b.String()
}

// ParseStyle reads "a: b; c: d" into an ordered map (lowercase names, trimmed values).
func ParseStyle(s string) map[string]string {
	out := map[string]string{}
	for _, part := range strings.Split(s, ";") {
		at := strings.Index(part, ":")
		if at < 0 {
			continue
		}
		k := asciiLower(jsonv.Trim(part[:at]))
		v := jsonv.Trim(part[at+1:])
		if k != "" && v != "" {
			out[k] = v
		}
	}
	return out
}
