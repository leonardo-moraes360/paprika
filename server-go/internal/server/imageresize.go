package server

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"math"
	"strings"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	xdraw "golang.org/x/image/draw"
	"golang.org/x/image/webp"
)

var resizePresets = map[string]image.Point{
	"qhd": {X: 960, Y: 540},
	"hd":  {X: 1280, Y: 720},
	"2k":  {X: 2560, Y: 1440},
	"4k":  {X: 3840, Y: 2160},
}

type resizeResult struct {
	data     []byte
	mime     string
	width    int
	height   int
	format   string
	srcFmt   string
	warning  string
	animated bool
}

func resolveResizeTarget(preset any) (int, int, error) {
	switch v := preset.(type) {
	case string:
		key := strings.ToLower(v)
		p, ok := resizePresets[key]
		if !ok {
			return 0, 0, fmt.Errorf("unknown preset %q: expected qhd, hd, 2k or 4k", v)
		}
		return p.X, p.Y, nil
	case *jsonv.Object:
		if v == nil {
			return 0, 0, fmt.Errorf("preset is required: qhd, hd, 2k, 4k or {width,height}")
		}
		w, h := int(math.Round(v.Num("width"))), int(math.Round(v.Num("height")))
		if w < 1 || h < 1 {
			return 0, 0, fmt.Errorf("preset width and height must be at least 1")
		}
		if w > maxImageSide || h > maxImageSide {
			return 0, 0, fmt.Errorf("preset size %dx%d exceeds the maximum side %d", w, h, maxImageSide)
		}
		return w, h, nil
	default:
		return 0, 0, fmt.Errorf("preset is required: qhd, hd, 2k, 4k or {width,height}")
	}
}

func decodePixels(info rasterInfo) (image.Image, string, error) {
	switch info.mime {
	case "image/png":
		img, err := png.Decode(bytes.NewReader(info.data))
		return img, "", err
	case "image/jpeg":
		img, err := jpeg.Decode(bytes.NewReader(info.data))
		if err != nil {
			return nil, "", err
		}
		return applyOrientation(img, jpegOrientation(info.data)), "", nil
	case "image/gif":
		img, err := gif.Decode(bytes.NewReader(info.data))
		warn := ""
		if info.animated {
			warn = "animated GIF: resized the first frame only"
		}
		return img, warn, err
	case "image/webp":
		if info.animated {
			return nil, "", fmt.Errorf("animated WebP cannot be resized: decode a still frame or use PNG/JPEG")
		}
		img, err := webp.Decode(bytes.NewReader(info.data))
		return img, "", err
	case "image/avif":
		return nil, "", fmt.Errorf("AVIF cannot be resized: no pure-Go pixel decoder (re-export as PNG or JPEG first)")
	default:
		return nil, "", fmt.Errorf("unsupported image format for resize: %s", info.mime)
	}
}

func applyOrientation(img image.Image, orient int) image.Image {
	if orient <= 1 || orient > 8 {
		return img
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	var dst *image.NRGBA
	switch orient {
	case 2:
		dst = image.NewNRGBA(image.Rect(0, 0, w, h))
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				dst.Set(w-1-x, y, img.At(b.Min.X+x, b.Min.Y+y))
			}
		}
	case 3:
		dst = image.NewNRGBA(image.Rect(0, 0, w, h))
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				dst.Set(w-1-x, h-1-y, img.At(b.Min.X+x, b.Min.Y+y))
			}
		}
	case 4:
		dst = image.NewNRGBA(image.Rect(0, 0, w, h))
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				dst.Set(x, h-1-y, img.At(b.Min.X+x, b.Min.Y+y))
			}
		}
	case 5:
		dst = image.NewNRGBA(image.Rect(0, 0, h, w))
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				dst.Set(y, x, img.At(b.Min.X+x, b.Min.Y+y))
			}
		}
	case 6:
		dst = image.NewNRGBA(image.Rect(0, 0, h, w))
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				dst.Set(h-1-y, x, img.At(b.Min.X+x, b.Min.Y+y))
			}
		}
	case 7:
		dst = image.NewNRGBA(image.Rect(0, 0, h, w))
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				dst.Set(h-1-y, w-1-x, img.At(b.Min.X+x, b.Min.Y+y))
			}
		}
	case 8:
		dst = image.NewNRGBA(image.Rect(0, 0, h, w))
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				dst.Set(y, w-1-x, img.At(b.Min.X+x, b.Min.Y+y))
			}
		}
	default:
		return img
	}
	return dst
}

func fitResize(src image.Image, tw, th int, fit string) *image.NRGBA {
	sb := src.Bounds()
	sw, sh := sb.Dx(), sb.Dy()
	if sw < 1 || sh < 1 || tw < 1 || th < 1 {
		return image.NewNRGBA(image.Rect(0, 0, max(tw, 1), max(th, 1)))
	}
	switch fit {
	case "fill":
		dst := image.NewNRGBA(image.Rect(0, 0, tw, th))
		xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, sb, xdraw.Over, nil)
		return dst
	case "cover":
		scale := math.Max(float64(tw)/float64(sw), float64(th)/float64(sh))
		rw := int(math.Round(float64(sw) * scale))
		rh := int(math.Round(float64(sh) * scale))
		if rw < 1 {
			rw = 1
		}
		if rh < 1 {
			rh = 1
		}
		tmp := image.NewNRGBA(image.Rect(0, 0, rw, rh))
		xdraw.CatmullRom.Scale(tmp, tmp.Bounds(), src, sb, xdraw.Over, nil)
		dst := image.NewNRGBA(image.Rect(0, 0, tw, th))
		ox := (rw - tw) / 2
		oy := (rh - th) / 2
		xdraw.Draw(dst, dst.Bounds(), tmp, image.Pt(ox, oy), xdraw.Src)
		return dst
	default:
		scale := math.Min(float64(tw)/float64(sw), float64(th)/float64(sh))
		rw := int(math.Round(float64(sw) * scale))
		rh := int(math.Round(float64(sh) * scale))
		if rw < 1 {
			rw = 1
		}
		if rh < 1 {
			rh = 1
		}
		dst := image.NewNRGBA(image.Rect(0, 0, rw, rh))
		xdraw.CatmullRom.Scale(dst, dst.Bounds(), src, sb, xdraw.Over, nil)
		return dst
	}
}

func encodeResized(img image.Image, srcMime string) ([]byte, string, string, error) {
	var buf bytes.Buffer
	switch srcMime {
	case "image/jpeg":
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
			return nil, "", "", err
		}
		return buf.Bytes(), "image/jpeg", "jpeg", nil
	case "image/gif":
		if err := gif.Encode(&buf, img, nil); err != nil {
			return nil, "", "", err
		}
		return buf.Bytes(), "image/gif", "gif", nil
	case "image/png":
		if err := png.Encode(&buf, img); err != nil {
			return nil, "", "", err
		}
		return buf.Bytes(), "image/png", "png", nil
	default:
		if err := png.Encode(&buf, img); err != nil {
			return nil, "", "", err
		}
		return buf.Bytes(), "image/png", "png", nil
	}
}

func resizeRaster(info rasterInfo, tw, th int, fit string) (resizeResult, error) {
	if fit == "" {
		fit = "contain"
	}
	switch fit {
	case "cover", "contain", "fill":
	default:
		return resizeResult{}, fmt.Errorf("fit must be cover, contain or fill")
	}
	img, warn, err := decodePixels(info)
	if err != nil {
		return resizeResult{}, err
	}
	out := fitResize(img, tw, th, fit)
	data, mime, format, err := encodeResized(out, info.mime)
	if err != nil {
		return resizeResult{}, err
	}
	if len(data) > MaxImportImageBytes {
		return resizeResult{}, tooLarge(int64(len(data)))
	}
	srcFmt := info.format()
	if mime != info.mime {
		if warn != "" {
			warn += "; "
		}
		warn += fmt.Sprintf("%s has no pure-Go encoder: wrote PNG", strings.ToUpper(srcFmt))
	}
	return resizeResult{
		data:     data,
		mime:     mime,
		width:    out.Bounds().Dx(),
		height:   out.Bounds().Dy(),
		format:   format,
		srcFmt:   srcFmt,
		warning:  warn,
		animated: info.animated,
	}, nil
}

func (r resizeResult) dataURL() string {
	return "data:" + r.mime + ";base64," + base64.StdEncoding.EncodeToString(r.data)
}
