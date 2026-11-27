package team

import (
	"errors"
	"strings"
	"testing"
)

func TestFindBinaryMissingSidecar(t *testing.T) {
	t.Setenv("PAPRIKA_SYNC", "")
	t.Setenv("PATH", t.TempDir())

	t.Setenv("PAPRIKA_WEB_ROOT", "")
	if _, err := FindBinary(); !errors.Is(err, ErrNoSidecar) || !strings.Contains(err.Error(), "cargo build") {
		t.Fatalf("from source, FindBinary() = %v, want the cargo build hint", err)
	}

	t.Setenv("PAPRIKA_WEB_ROOT", "/app/web")
	_, err := FindBinary()
	if !errors.Is(err, ErrNoSidecarInImage) {
		t.Fatalf("in the image, FindBinary() = %v, want ErrNoSidecarInImage", err)
	}
	if !strings.Contains(err.Error(), "slim image has no team mode") || strings.Contains(err.Error(), "cargo") {
		t.Fatalf("message = %q: it must say the slim image has no team mode and not send the user to cargo", err)
	}
}
