package server

import (
	"os"
	"testing"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
)

func TestMain(m *testing.M) {
	core.SetStrictOwnership(true)
	code := m.Run()
	if n := core.OwnershipFallbacks(); n != 0 {
		println("ownership fallbacks:", n)
		code = 1
	}
	os.Exit(code)
}
