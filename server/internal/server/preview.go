package server

import (
	"database/sql"
	"encoding/json"
	"math"
	"strings"
)

type PreviewShape struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	W    float64 `json:"w"`
	H    float64 `json:"h"`
	Fill string  `json:"fill"`
}

const previewLimit = 8

func previewShapes(db *sql.DB, docID string) ([]PreviewShape, error) {
	var pageID string
	err := db.QueryRow(`SELECT id FROM nodes WHERE doc_id = ? AND type = 'page' AND parent_id IS NULL ORDER BY ord LIMIT 1`, docID).Scan(&pageID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	shapes, err := previewQuery(db, docID, pageID)
	if err != nil {
		return nil, err
	}
	if len(shapes) == 0 && pageID != "" {
		shapes, err = previewQuery(db, docID, "")
		if err != nil {
			return nil, err
		}
	}
	if shapes == nil {
		shapes = []PreviewShape{}
	}
	return shapes, nil
}

func previewQuery(db *sql.DB, docID, parentID string) ([]PreviewShape, error) {
	var (
		rows *sql.Rows
		err  error
	)
	if parentID == "" {
		rows, err = db.Query(`SELECT data FROM nodes WHERE doc_id = ? AND parent_id IS NULL AND type IN ('frame', 'rect', 'ellipse', 'image') ORDER BY ord LIMIT ?`, docID, previewLimit)
	} else {
		rows, err = db.Query(`SELECT data FROM nodes WHERE doc_id = ? AND parent_id = ? AND type IN ('frame', 'rect', 'ellipse', 'image') ORDER BY ord LIMIT ?`, docID, parentID, previewLimit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PreviewShape{}
	for rows.Next() {
		var data string
		if err := rows.Scan(&data); err != nil {
			return nil, err
		}
		if shape, ok := previewBox(data); ok {
			out = append(out, shape)
		}
	}
	return out, rows.Err()
}

func previewBox(data string) (PreviewShape, bool) {
	var raw map[string]any
	if json.Unmarshal([]byte(data), &raw) != nil {
		return PreviewShape{}, false
	}
	x, xok := previewNum(raw["x"], true)
	y, yok := previewNum(raw["y"], true)
	w, wok := previewNum(raw["width"], false)
	h, hok := previewNum(raw["height"], false)
	if !xok || !yok || !wok || !hok || w <= 0 || h <= 0 || math.IsNaN(w) || math.IsNaN(h) {
		return PreviewShape{}, false
	}
	return PreviewShape{X: round2(x), Y: round2(y), W: round2(w), H: round2(h), Fill: previewFill(raw["fill"])}, true
}

func previewNum(v any, missingZero bool) (float64, bool) {
	if v == nil && missingZero {
		return 0, true
	}
	f, ok := v.(float64)
	return f, ok
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func previewFill(v any) string {
	s, ok := v.(string)
	if !ok || !previewColor(s) {
		return "#e7d7c3"
	}
	return s
}

func previewColor(s string) bool {
	if s == "" || s == "transparent" || s == "none" || strings.HasPrefix(s, "$") {
		return false
	}
	if strings.HasPrefix(s, "#") {
		rest := s[1:]
		if len(rest) != 3 && len(rest) != 4 && len(rest) != 6 && len(rest) != 8 {
			return false
		}
		for _, c := range rest {
			if (c < '0' || c > '9') && (c < 'a' || c > 'f') && (c < 'A' || c > 'F') {
				return false
			}
		}
		return true
	}
	return strings.HasPrefix(s, "rgb(") || strings.HasPrefix(s, "rgba(") || strings.HasPrefix(s, "hsl(") || strings.HasPrefix(s, "hsla(") || strings.HasPrefix(s, "oklch(")
}
