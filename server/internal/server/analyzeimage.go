package server

import (
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"strings"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
	"github.com/leonardo-moraes360/paprika/server/internal/vision"
)

// looksLikeBase64 tells raw base64 from a file path: long, only base64 characters and no dot
// (a path to an image has an extension).
func looksLikeBase64(s string) bool {
	if len(s) < 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '+', c == '/', c == '=', c == '\n', c == '\r':
		default:
			return false
		}
	}
	return true
}

// normalizeImageSrc lets an image come as a data URL, raw base64 or a path under
// PAPRIKA_IMPORT_DIRS; raw base64 is wrapped into a data URL for the shared loader.
func normalizeImageSrc(src string) string {
	src = strings.TrimSpace(src)
	if looksLikeBase64(src) {
		clean := strings.NewReplacer("\n", "", "\r", "").Replace(src)
		if _, err := base64.StdEncoding.DecodeString(clean); err == nil {
			return "data:application/octet-stream;base64," + clean
		}
	}
	return src
}

// analyzeSource loads the pixels of the image analyze_image was pointed at.
func analyzeSource(a *jsonv.Object, doc func() (*core.Document, error)) (rasterInfo, error) {
	hasSrc, hasNode := a.Has("src"), a.Has("nodeId")
	switch {
	case hasSrc && hasNode:
		return rasterInfo{}, errors.New("analyze_image takes src or nodeId, not both")
	case !hasSrc && !hasNode:
		return rasterInfo{}, errors.New("analyze_image requires src (data URL, raw base64 or a path under PAPRIKA_IMPORT_DIRS) or nodeId (an image node)")
	}
	src := a.Str("src")
	if hasNode {
		d, err := doc()
		if err != nil {
			return rasterInfo{}, err
		}
		if src, err = imageNodeSrc(d, a.Str("nodeId")); err != nil {
			return rasterInfo{}, err
		}
	}
	info, _, err := loadImportImage(normalizeImageSrc(src))
	return info, err
}

// imageNodeSrc is the src of an image node, with a $asset name resolved.
func imageNodeSrc(d *core.Document, id string) (string, error) {
	n := core.GetNode(d, id)
	if n == nil {
		return "", fmt.Errorf("node %q not found", id)
	}
	if n.Str("type") != "image" {
		return "", fmt.Errorf("node %q is a %s, not an image", id, n.Str("type"))
	}
	src := n.Str("src")
	if name, ok := strings.CutPrefix(src, "$"); ok {
		asset := ""
		if assets := d.Obj("assets"); assets != nil {
			asset = assets.Str(name)
		}
		if asset == "" {
			return "", fmt.Errorf("node %q uses the asset $%s, which is not set", id, name)
		}
		src = asset
	}
	return src, nil
}

// decodeForVision decodes the pixels of a loaded image for the vision tools (first frame of an
// animation) and refuses what has no pure-Go decoder.
func decodeForVision(info rasterInfo) (image.Image, string, error) {
	switch {
	case info.mime == "image/avif":
		return nil, "", errors.New("AVIF cannot be analyzed: no pure-Go pixel decoder (re-export as PNG or JPEG first)")
	case info.mime == "image/webp" && info.animated:
		return nil, "", errors.New("animated WebP cannot be analyzed: use a still frame (PNG or JPEG)")
	}
	return decodePixels(info)
}

func analyzeImage(a *jsonv.Object, doc func() (*core.Document, error)) (ToolResult, error) {
	info, err := analyzeSource(a, doc)
	if err != nil {
		return nil, err
	}
	img, warn, err := decodeForVision(info)
	if err != nil {
		return nil, err
	}
	opts := vision.Options{
		MaxColors: int(a.Num("maxColors")),
		MinArea:   a.Num("minArea"),
		MaxBlobs:  int(a.Num("maxBlobs")),
		MaxPoints: int(a.Num("maxPoints")),
		Scale:     1,
	}
	if r := a.Obj("region"); r != nil {
		opts.Region = &vision.Rect{X: r.Num("x"), Y: r.Num("y"), Width: r.Num("width"), Height: r.Num("height")}
	}
	var placed *vision.Rect
	if f := a.Obj("frame"); f != nil {
		fw, fh := f.Num("width"), f.Num("height")
		iw, ih := float64(info.width), float64(info.height)
		x, y, w, _ := fitPlacement(fw, fh, iw, ih) // the same fit place_reference uses
		opts.Scale, opts.OffsetX, opts.OffsetY = w/iw, x, y
		placed = &vision.Rect{X: x, Y: y, Width: w, Height: round2(ih * opts.Scale)}
	}
	res, err := vision.Analyze(img, opts)
	if err != nil {
		return nil, err
	}
	res.Placed = placed
	if warn != "" {
		res.Warnings = append(res.Warnings, warn)
	}
	if info.animated {
		res.Warnings = append(res.Warnings, "animated image: analyzed the first frame only")
	}
	out := textResult(res.Summary())
	out.Set("structuredContent", jsonv.FromGo(res))
	return out, nil
}
