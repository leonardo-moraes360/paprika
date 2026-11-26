package server

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
)

const (
	immutableCache = "public, max-age=31536000, immutable"
	gzipMinBytes   = 1024
	gzipCacheMax   = 64
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
	zw.Write(data)
	zw.Close()
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
		if acceptsGzip(r) {
			data = gzipped(file, data)
			h.Set("content-encoding", "gzip")
		}
	}
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(data)
	}
}
