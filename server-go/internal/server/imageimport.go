package server

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

const (
	MaxImportImageBytes = 3_500_000
	ImportDirsEnv       = "PAPRIKA_IMPORT_DIRS"
	maxImageSide        = 65535
)

type rasterInfo struct {
	mime     string
	width    int
	height   int
	animated bool
	data     []byte
}

func importDirs() ([]string, error) {
	var raw []string
	if env := os.Getenv(ImportDirsEnv); env != "" {
		raw = filepath.SplitList(env)
	} else {
		wd, err := os.Getwd()
		if err != nil {
			return nil, err
		}
		raw = []string{wd}
	}
	var dirs []string
	for _, d := range raw {
		if d == "" {
			continue
		}
		abs, err := filepath.Abs(d)
		if err != nil {
			continue
		}
		if real, err := filepath.EvalSymlinks(abs); err == nil {
			abs = real
		}
		dirs = append(dirs, abs)
	}
	if len(dirs) == 0 {
		return nil, errors.New("no directory is allowed for import_image: set " + ImportDirsEnv)
	}
	return dirs, nil
}

func within(dir, path string) bool {
	rel, err := filepath.Rel(dir, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func tooLarge(n int64) error {
	return fmt.Errorf("image is too large: %d bytes (limit %d bytes)", n, MaxImportImageBytes)
}

func readImageFile(path string) ([]byte, string, error) {
	dirs, err := importDirs()
	if err != nil {
		return nil, "", err
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(dirs[0], path)
	}
	real, err := filepath.EvalSymlinks(filepath.Clean(path))
	if err != nil {
		return nil, "", fmt.Errorf("cannot read %q: file not found", path)
	}
	allowed := false
	for _, d := range dirs {
		if within(d, real) {
			allowed = true
			break
		}
	}
	if !allowed {
		return nil, "", fmt.Errorf("path %q is outside the allowed directories (%s; set %s)", path, strings.Join(dirs, ", "), ImportDirsEnv)
	}
	st, err := os.Stat(real)
	if err != nil {
		return nil, "", fmt.Errorf("cannot read %q: %w", path, err)
	}
	if !st.Mode().IsRegular() {
		return nil, "", fmt.Errorf("%q is not a regular file", path)
	}
	if st.Size() > MaxImportImageBytes {
		return nil, "", tooLarge(st.Size())
	}
	f, err := os.Open(real)
	if err != nil {
		return nil, "", fmt.Errorf("cannot read %q: %w", path, err)
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, MaxImportImageBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("cannot read %q: %w", path, err)
	}
	if len(data) > MaxImportImageBytes {
		return nil, "", tooLarge(int64(len(data)))
	}
	base := filepath.Base(real)
	return data, strings.TrimSuffix(base, filepath.Ext(base)), nil
}

func decodeDataURL(src string) ([]byte, error) {
	comma := strings.IndexByte(src, ',')
	if comma < 0 {
		return nil, errors.New("src is not a valid data URL")
	}
	meta := strings.ToLower(src[len("data:"):comma])
	payload := src[comma+1:]
	if !strings.HasSuffix(meta, ";base64") {
		unescaped, err := url.PathUnescape(payload)
		if err != nil {
			return nil, errors.New("src is not a valid data URL")
		}
		if len(unescaped) > MaxImportImageBytes {
			return nil, tooLarge(int64(len(unescaped)))
		}
		return []byte(unescaped), nil
	}
	if base64.StdEncoding.DecodedLen(len(payload)) > MaxImportImageBytes+3 {
		return nil, tooLarge(int64(base64.StdEncoding.DecodedLen(len(payload))))
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, errors.New("src is not a valid base64 data URL")
	}
	if len(data) > MaxImportImageBytes {
		return nil, tooLarge(int64(len(data)))
	}
	return data, nil
}

func loadImportImage(src string) (rasterInfo, string, error) {
	var data []byte
	var name string
	var err error
	switch {
	case strings.HasPrefix(src, "data:"):
		data, err = decodeDataURL(src)
	case strings.HasPrefix(src, "http://") || strings.HasPrefix(src, "https://"):
		return rasterInfo{}, "", errors.New("src must be a data URL or a local file path: http(s) URLs are not fetched")
	default:
		data, name, err = readImageFile(src)
	}
	if err != nil {
		return rasterInfo{}, "", err
	}
	info, err := sniffRaster(data)
	if err != nil {
		return rasterInfo{}, "", err
	}
	return info, name, nil
}

func sniffRaster(data []byte) (rasterInfo, error) {
	info := rasterInfo{data: data}
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")):
		info.mime = "image/png"
		cfg, err := png.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return info, fmt.Errorf("invalid PNG: %w", err)
		}
		info.width, info.height = cfg.Width, cfg.Height
	case bytes.HasPrefix(data, []byte{0xFF, 0xD8, 0xFF}):
		info.mime = "image/jpeg"
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return info, fmt.Errorf("invalid JPEG: %w", err)
		}
		info.width, info.height = cfg.Width, cfg.Height
		if jpegOrientation(data) >= 5 {
			info.width, info.height = info.height, info.width
		}
	case bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a")):
		info.mime = "image/gif"
		cfg, err := gif.DecodeConfig(bytes.NewReader(data))
		if err != nil {
			return info, fmt.Errorf("invalid GIF: %w", err)
		}
		info.width, info.height = cfg.Width, cfg.Height
		info.animated = gifFrames(data) > 1
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		info.mime = "image/webp"
		if err := webpInfo(data, &info); err != nil {
			return info, err
		}
	case len(data) >= 12 && string(data[4:8]) == "ftyp":
		if err := avifInfo(data, &info); err != nil {
			return info, err
		}
	default:
		return info, errors.New("unsupported image format: expected PNG, JPEG, WebP, AVIF or GIF")
	}
	if info.width < 1 || info.height < 1 || info.width > maxImageSide || info.height > maxImageSide {
		return info, fmt.Errorf("invalid image size %dx%d", info.width, info.height)
	}
	return info, nil
}

func jpegOrientation(b []byte) int {
	i := 2
	for i+4 <= len(b) && b[i] == 0xFF {
		marker := b[i+1]
		if marker == 0xDA || marker == 0xD9 {
			return 1
		}
		size := int(binary.BigEndian.Uint16(b[i+2 : i+4]))
		if size < 2 || i+2+size > len(b) {
			return 1
		}
		if marker == 0xE1 && size >= 16 && string(b[i+4:i+10]) == "Exif\x00\x00" {
			return tiffOrientation(b[i+10 : i+2+size])
		}
		i += 2 + size
	}
	return 1
}

func tiffOrientation(t []byte) int {
	var order binary.ByteOrder
	switch {
	case len(t) >= 8 && string(t[:2]) == "II":
		order = binary.LittleEndian
	case len(t) >= 8 && string(t[:2]) == "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	ifd := int(order.Uint32(t[4:8]))
	if ifd < 8 || ifd+2 > len(t) {
		return 1
	}
	n := int(order.Uint16(t[ifd : ifd+2]))
	for e := 0; e < n; e++ {
		at := ifd + 2 + e*12
		if at+12 > len(t) {
			return 1
		}
		if order.Uint16(t[at:at+2]) == 0x0112 {
			return int(order.Uint16(t[at+8 : at+10]))
		}
	}
	return 1
}

func gifFrames(b []byte) int {
	if len(b) < 13 {
		return 1
	}
	i := 13
	if b[10]&0x80 != 0 {
		i += 3 << ((b[10] & 7) + 1)
	}
	skipBlocks := func() bool {
		for i < len(b) {
			n := int(b[i])
			i++
			if n == 0 {
				return true
			}
			i += n
		}
		return false
	}
	frames := 0
	for i < len(b) {
		switch b[i] {
		case 0x21:
			i += 2
			if !skipBlocks() {
				return max(frames, 1)
			}
		case 0x2C:
			if i+10 > len(b) {
				return max(frames, 1)
			}
			flags := b[i+9]
			i += 10
			if flags&0x80 != 0 {
				i += 3 << ((flags & 7) + 1)
			}
			i++
			if !skipBlocks() {
				return max(frames+1, 1)
			}
			frames++
		default:
			return max(frames, 1)
		}
	}
	return max(frames, 1)
}

func webpInfo(b []byte, info *rasterInfo) error {
	if len(b) < 30 {
		return errors.New("invalid WebP: truncated")
	}
	chunk := string(b[12:16])
	body := b[20:]
	switch chunk {
	case "VP8 ":
		if len(body) < 10 || body[3] != 0x9d || body[4] != 0x01 || body[5] != 0x2a {
			return errors.New("invalid WebP: bad VP8 header")
		}
		info.width = int(binary.LittleEndian.Uint16(body[6:8]) & 0x3fff)
		info.height = int(binary.LittleEndian.Uint16(body[8:10]) & 0x3fff)
	case "VP8L":
		if len(body) < 5 || body[0] != 0x2f {
			return errors.New("invalid WebP: bad VP8L header")
		}
		bits := binary.LittleEndian.Uint32(body[1:5])
		info.width = int(bits&0x3fff) + 1
		info.height = int((bits>>14)&0x3fff) + 1
	case "VP8X":
		if len(body) < 10 {
			return errors.New("invalid WebP: bad VP8X header")
		}
		info.width = int(uint32(body[4])|uint32(body[5])<<8|uint32(body[6])<<16) + 1
		info.height = int(uint32(body[7])|uint32(body[8])<<8|uint32(body[9])<<16) + 1
		info.animated = body[0]&0x02 != 0
	default:
		return errors.New("invalid WebP: unknown first chunk")
	}
	return nil
}

func isoBoxes(b []byte, visit func(kind string, body []byte)) {
	for len(b) >= 8 {
		size := uint64(binary.BigEndian.Uint32(b[:4]))
		head := 8
		if size == 1 {
			if len(b) < 16 {
				return
			}
			size = binary.BigEndian.Uint64(b[8:16])
			head = 16
		} else if size == 0 {
			size = uint64(len(b))
		}
		if size < uint64(head) || size > uint64(len(b)) {
			return
		}
		visit(string(b[4:8]), b[head:size])
		b = b[size:]
	}
}

func avifInfo(data []byte, info *rasterInfo) error {
	brands := map[string]bool{}
	bestArea := 0
	isoBoxes(data, func(kind string, body []byte) {
		switch kind {
		case "ftyp":
			if len(body) >= 4 {
				brands[string(body[:4])] = true
			}
			for i := 8; i+4 <= len(body); i += 4 {
				brands[string(body[i:i+4])] = true
			}
		case "meta":
			if len(body) < 4 {
				return
			}
			isoBoxes(body[4:], func(kind string, body []byte) {
				if kind != "iprp" {
					return
				}
				isoBoxes(body, func(kind string, body []byte) {
					if kind != "ipco" {
						return
					}
					isoBoxes(body, func(kind string, body []byte) {
						if kind != "ispe" || len(body) < 12 {
							return
						}
						w := int(binary.BigEndian.Uint32(body[4:8]))
						h := int(binary.BigEndian.Uint32(body[8:12]))
						if area := w * h; w > 0 && h > 0 && area > bestArea && w <= maxImageSide && h <= maxImageSide {
							bestArea = area
							info.width, info.height = w, h
						}
					})
				})
			})
		}
	})
	if !brands["avif"] && !brands["avis"] {
		return errors.New("unsupported image format: expected PNG, JPEG, WebP, AVIF or GIF")
	}
	if bestArea == 0 {
		return errors.New("invalid AVIF: no image size found")
	}
	info.mime = "image/avif"
	info.animated = brands["avis"]
	return nil
}

func fitWidth(width, height int, maxWidth float64) (float64, float64) {
	w, h := float64(width), float64(height)
	if maxWidth > 0 && w > maxWidth {
		return maxWidth, math.Round(h*maxWidth/w*100) / 100
	}
	return w, h
}

func (r rasterInfo) dataURL() string {
	return "data:" + r.mime + ";base64," + base64.StdEncoding.EncodeToString(r.data)
}

func (r rasterInfo) format() string {
	return strings.TrimPrefix(r.mime, "image/")
}
