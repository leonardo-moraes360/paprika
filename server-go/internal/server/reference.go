package server

import (
	"math"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
)

func referencePlacement(frame *core.Node, imgW, imgH float64) (x, y, w, h float64) {
	w, h = imgW, imgH
	fw, fok := positiveFloat(frame, "width")
	fh, hok := positiveFloat(frame, "height")
	if !fok || !hok {
		return 0, 0, w, h
	}
	return fitPlacement(fw, fh, imgW, imgH)
}

// fitPlacement fits an image inside a fw x fh box, centered, keeping its aspect ratio.
func fitPlacement(fw, fh, imgW, imgH float64) (x, y, w, h float64) {
	w, h = imgW, imgH
	if imgW <= 0 || imgH <= 0 {
		return 0, 0, w, h
	}
	scale := math.Min(fw/imgW, fh/imgH)
	if scale <= 0 || math.IsInf(scale, 0) || math.IsNaN(scale) {
		return 0, 0, w, h
	}
	w = round2(imgW * scale)
	h = round2(imgH * scale)
	return round2((fw - w) / 2), round2((fh - h) / 2), w, h
}

func positiveFloat(n *core.Node, key string) (float64, bool) {
	v, ok := n.Get(key)
	f, okNum := v.(float64)
	if !ok || !okNum || f <= 0 || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, false
	}
	return f, true
}
