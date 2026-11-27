package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/leonardo-moraes360/paprika/server/internal/server"
)

func logf(m string) { fmt.Fprintf(os.Stderr, "[paprika] %s\n", m) }

func webRoot(flagValue string) string {
	candidates := []string{flagValue, os.Getenv("PAPRIKA_WEB_ROOT")}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates, filepath.Join(dir, "web"), filepath.Join(dir, "../apps/web/dist/client"), filepath.Join(dir, "../../apps/web/dist/client"))
	}
	candidates = append(candidates, "apps/web/dist/client", "../apps/web/dist/client")
	for i, c := range candidates {
		if c != "" && server.WebEntry(c) != "" {
			return c
		}
		if i < 2 && c != "" {
			logf("aviso: " + c + " não tem _shell.html nem index.html; procurando o app em outro lugar")
		}
	}
	return ""
}

func main() {
	os.Exit(execute(os.Args[1:], os.Stdout, os.Stderr))
}

type usageError struct{ message string }

func (e usageError) Error() string { return e.message }

func execute(args []string, stdout, stderr io.Writer) int {
	root := newRootCmd(defaultHandlers())
	root.SetArgs(args)
	root.SetOut(stdout)
	root.SetErr(stderr)
	err := root.Execute()
	if err == nil {
		return 0
	}
	if ue, ok := errors.AsType[usageError](err); ok {
		if ue.message == "" {
			_ = root.Help()
		} else {
			fmt.Fprintf(stderr, "[paprika] erro: %s\n", ue.message)
		}
		return 2
	}
	fmt.Fprintf(stderr, "[paprika] erro: %s\n", err)
	return 1
}
