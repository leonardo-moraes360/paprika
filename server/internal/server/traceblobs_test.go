package server

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func TestTraceImageBlobIDsMatchAnalyze(t *testing.T) {
	m, _, _ := resizeSetup(t)
	src := "data:image/png;base64," + base64.StdEncoding.EncodeToString(logoPNG(t))
	an, text, isErr := analyzeCall(t, m, obj("src", src))
	if isErr {
		t.Fatal(text)
	}
	blobs := an.Arr("blobs")
	if len(blobs) != 2 {
		t.Fatalf("blobs: %s", text)
	}
	for _, b := range blobs {
		blob := b.(*jsonv.Object)
		sc, text, isErr := traceCall(t, m, obj("src", src, "dryRun", true, "blobIds", []any{blob.Str("id")}))
		if isErr {
			t.Fatal(text)
		}
		paths := sc.Arr("paths")
		if len(paths) != 1 {
			t.Fatalf("%s: %s", blob.Str("id"), text)
		}
		p := paths[0].(*jsonv.Object)
		if p.Str("blobId") != blob.Str("id") || p.Str("color") != blob.Str("color") {
			t.Fatalf("path %s vs blob %s", jsonv.Stringify(p, ""), jsonv.Stringify(blob, ""))
		}
		if sk := sc.Obj("skipped"); sk.Num("notListed") != 1 || sk.Num("excluded") != 0 {
			t.Fatalf("skipped: %s", jsonv.Stringify(sk, ""))
		}
	}
	sc, _, isErr := traceCall(t, m, obj("src", src, "dryRun", true, "blobIds", []any{"b9"}))
	if isErr || len(sc.Arr("paths")) != 0 || !strings.Contains(strings.Join(sc.Strings("warnings"), " "), "b9") {
		t.Fatalf("unknown id: %v", sc)
	}
}

func TestTraceImageExcludeAndDropReport(t *testing.T) {
	m, _, _ := resizeSetup(t)
	src := "data:image/png;base64," + base64.StdEncoding.EncodeToString(logoPNG(t))
	sc, text, isErr := traceCall(t, m, obj("src", src, "dryRun", true, "exclude", []any{obj("x", 105.0, "y", 25.0, "width", 80.0, "height", 50.0)}))
	if isErr {
		t.Fatal(text)
	}
	paths := sc.Arr("paths")
	if len(paths) != 1 || paths[0].(*jsonv.Object).Str("color") != "#dc1e28" || sc.Obj("skipped").Num("excluded") != 1 {
		t.Fatalf("exclude: %s", text)
	}
	sc, text, isErr = traceCall(t, m, obj("src", src, "dryRun", true, "maxPaths", 1.0))
	if isErr {
		t.Fatal(text)
	}
	if !sc.Bool("truncated") || sc.Num("pathCount") != 2 || sc.Num("drawn") != 1 || sc.Num("dropped") != 1 || len(sc.Strings("droppedIds")) != 1 {
		t.Fatalf("drop report: %s", text)
	}
	if got := sc.Strings("droppedIds")[0]; got == sc.Arr("paths")[0].(*jsonv.Object).Str("blobId") {
		t.Fatalf("the dropped blob %s is also drawn", got)
	}
	sc, _, _ = traceCall(t, m, obj("src", src, "dryRun", true))
	if sc.Num("dropped") != 0 || sc.Arr("droppedIds") == nil || len(sc.Arr("droppedIds")) != 0 {
		t.Fatalf("no cut: dropped %v", sc.Num("dropped"))
	}
}
