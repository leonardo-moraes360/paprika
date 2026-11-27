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
	msg := err.Error()
	if !strings.Contains(msg, "/app/paprika-sync is expected") || !strings.Contains(msg, "broken or custom") || strings.Contains(msg, "cargo") || strings.Contains(msg, "no team mode") {
		t.Fatalf("message = %q: it must say the sidecar is expected in the image, not claim a no-team-mode image and not send the user to cargo", err)
	}
}
