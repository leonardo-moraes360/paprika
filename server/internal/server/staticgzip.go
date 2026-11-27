package server

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
)

const (
	immutableCache = "public, max-age=31536000, immutable"
	gzipMinBytes   = 1024
	gzipCacheMax   = 64
	embeddedCache  = "public, max-age=604800"
)

var compressibleTypes = []string{"text/", "application/javascript", "application/json", "application/wasm", "image/svg+xml"}

type gzipEntry struct {
	sum  [sha256.Size]byte
	data []byte
}

var gzipCache = struct {
	sync.Mutex
	m map[string]gzipEntry
}{m: map[string]gzipEntry{}}

func hashedAsset(file string) bool {
	return strings.HasPrefix(filepath.ToSlash(file), "assets/")
}

func compressible(ct string) bool {
	for _, p := range compressibleTypes {
		if strings.HasPrefix(ct, p) {
			return true
		}
	}
	return false
}

func acceptsGzip(r *http.Request) bool {
	for part := range strings.SplitSeq(r.Header.Get("Accept-Encoding"), ",") {
		name, q, _ := strings.Cut(strings.TrimSpace(part), ";")
		if strings.EqualFold(strings.TrimSpace(name), "gzip") {
			return strings.ReplaceAll(strings.TrimSpace(q), " ", "") != "q=0"
		}
	}
	return false
}

func gzipped(file string, data []byte) []byte {
	sum := sha256.Sum256(data)
	gzipCache.Lock()
	if e, ok := gzipCache.m[file]; ok && e.sum == sum {
		gzipCache.Unlock()
		return e.data
	}
	gzipCache.Unlock()
	var buf bytes.Buffer
	zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if _, err := zw.Write(data); err != nil {
		return nil
	}
	if err := zw.Close(); err != nil {
		return nil
	}
	out := buf.Bytes()
	gzipCache.Lock()
	if len(gzipCache.m) >= gzipCacheMax {
		clear(gzipCache.m)
	}
	gzipCache.m[file] = gzipEntry{sum: sum, data: out}
	gzipCache.Unlock()
	return out
}

func sendStatic(w http.ResponseWriter, r *http.Request, file string, data []byte, ct string) {
	h := w.Header()
	h.Set("content-type", ct)
	if hashedAsset(file) {
		h.Set("cache-control", immutableCache)
	} else {
		h.Set("cache-control", "no-store")
	}
	h.Set("x-content-type-options", "nosniff")
	if len(data) >= gzipMinBytes && compressible(ct) {
		h.Add("vary", "Accept-Encoding")
		if z := gzippedIf(acceptsGzip(r), file, data); z != nil {
			data = z
			h.Set("content-encoding", "gzip")
		}
	}
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(data)
	}
}

func gzippedIf(ok bool, file string, data []byte) []byte {
	if !ok {
		return nil
	}
	return gzipped(file, data)
}

// sendEmbedded serves content compiled into the binary (fonts and their CSS). The URLs carry no hash, so the cache
// is a week with an ETag: a browser that revalidates gets a 304, and a new binary with other bytes changes the tag.
func sendEmbedded(w http.ResponseWriter, r *http.Request, data []byte, ct string) {
	sum := sha256.Sum256(data)
	tag := `"` + hex.EncodeToString(sum[:8]) + `"`
	h := w.Header()
	h.Set("content-type", ct)
	h.Set("cache-control", embeddedCache)
	h.Set("etag", tag)
	h.Set("x-content-type-options", "nosniff")
	if match := r.Header.Get("If-None-Match"); match != "" {
		for part := range strings.SplitSeq(match, ",") {
			if p := strings.TrimSpace(part); p == tag || p == "*" {
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}
	}
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(data)
	}
}
