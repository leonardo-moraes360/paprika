package core

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	SetStrictOwnership(true)
	os.Exit(m.Run())
}
