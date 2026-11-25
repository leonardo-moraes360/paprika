package main

import (
	"bytes"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

var update = flag.Bool("update", false, "rewrite the golden files")

func fixedEnv(t *testing.T) {
	t.Helper()
	t.Setenv("PAPRIKA_DB", "")
	t.Setenv("USER", "tester")
}

func checkGolden(t *testing.T, name, got string) {
	t.Helper()
	path := filepath.Join("testdata", name)
	if *update {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(got), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run go test ./cmd/paprika -update)", err)
	}
	if string(want) != got {
		t.Errorf("%s differs from the golden file (run go test ./cmd/paprika -update to accept):\n--- want\n%s\n--- got\n%s", name, want, got)
	}
}

func commandPaths(root *cobra.Command) [][]string {
	paths := [][]string{{}}
	var visit func(c *cobra.Command, prefix []string)
	visit = func(c *cobra.Command, prefix []string) {
		for _, sub := range c.Commands() {
			p := append(append([]string{}, prefix...), sub.Name())
			paths = append(paths, p)
			visit(sub, p)
		}
	}
	visit(root, nil)
	return paths
}

func TestHelpGolden(t *testing.T) {
	fixedEnv(t)
	for _, path := range commandPaths(newRootCmd(defaultHandlers())) {
		name := "root"
		if len(path) > 0 {
			name = strings.Join(path, "-")
		}
		t.Run(name, func(t *testing.T) {
			var out, errOut bytes.Buffer
			code := execute(append(append([]string{}, path...), "--help"), &out, &errOut)
			if code != 0 {
				t.Fatalf("exit code %d, stderr: %s", code, errOut.String())
			}
			if errOut.Len() != 0 {
				t.Errorf("--help wrote to stderr: %s", errOut.String())
			}
			checkGolden(t, "help/"+name+".golden", out.String())
		})
	}
}

func TestFlagTableGolden(t *testing.T) {
	fixedEnv(t)
	root := newRootCmd(defaultHandlers())
	var table strings.Builder
	for _, path := range commandPaths(root) {
		cmd, _, err := root.Find(path)
		if err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(&table, "[paprika %s]\n", strings.Join(path, " "))
		cmd.LocalFlags().VisitAll(func(f *pflag.Flag) {
			fmt.Fprintf(&table, "--%s\t-%s\t%s\t%q\n", f.Name, f.Shorthand, f.Value.Type(), f.DefValue)
		})
	}
	checkGolden(t, "flags.golden", table.String())
}

func TestFlagDefaultsFromEnvironment(t *testing.T) {
	t.Setenv("PAPRIKA_DB", "/data/paprika.db")
	t.Setenv("USER", "ana")
	var got serveOptions
	root := newRootCmd(handlers{serve: func(o serveOptions) error { got = o; return nil }})
	root.SetArgs([]string{"serve"})
	if err := root.Execute(); err != nil {
		t.Fatal(err)
	}
	if got.DB != "/data/paprika.db" || got.TeamName != "ana" {
		t.Errorf("env defaults not applied: %+v", got)
	}
}

type recorded struct {
	command string
	options any
}

func recordingHandlers(rec *recorded) handlers {
	return handlers{
		serve:      func(o serveOptions) error { *rec = recorded{"serve", o}; return nil },
		mcp:        func(o mcpOptions) error { *rec = recorded{"mcp", o}; return nil },
		importFile: func(o importOptions) error { *rec = recorded{"import", o}; return nil },
		export:     func(o exportOptions) error { *rec = recorded{"export", o}; return nil },
		list:       func(o listOptions) error { *rec = recorded{"list", o}; return nil },
	}
}

func TestExistingInvocationsParseToTheSameOptions(t *testing.T) {
	fixedEnv(t)
	cases := []struct {
		name string
		args []string
		want recorded
	}{
		{
			name: "Dockerfile CMD",
			args: []string{"serve", "--host", "0.0.0.0", "--port", "4777"},
			want: recorded{"serve", serveOptions{DB: "paprika.db", Port: 4777, Host: "0.0.0.0", TeamName: "tester"}},
		},
		{
			name: "compose.team.yaml command",
			args: []string{"serve", "--host", "0.0.0.0", "--port", "4777", "--team", "--team-name", "paprika", "--team-bind", "0.0.0.0:4778"},
			want: recorded{"serve", serveOptions{DB: "paprika.db", Port: 4777, Host: "0.0.0.0", Team: true, TeamName: "paprika", TeamBind: "0.0.0.0:4778"}},
		},
		{
			name: "e2e harness serve",
			args: []string{"serve", "--db", "/tmp/x.db", "--port", "0", "--web", "/tmp/web"},
			want: recorded{"serve", serveOptions{DB: "/tmp/x.db", Port: 0, Host: "127.0.0.1", Web: "/tmp/web", TeamName: "tester"}},
		},
		{
			name: "e2e harness mcp",
			args: []string{"mcp", "--db", "/tmp/x.db", "--no-ui"},
			want: recorded{"mcp", mcpOptions{DB: "/tmp/x.db", Port: 4777, Host: "127.0.0.1", NoUI: true}},
		},
		{
			name: "e2e harness import",
			args: []string{"import", "/tmp/doc.paprika.json", "--db", "/tmp/x.db"},
			want: recorded{"import", importOptions{DB: "/tmp/x.db", File: "/tmp/doc.paprika.json"}},
		},
		{
			name: "package.json dev import",
			args: []string{"import", "packages/e2e/fixtures/demo.paprika.json", "--db", "dev.db", "--replace"},
			want: recorded{"import", importOptions{DB: "dev.db", Replace: true, File: "packages/e2e/fixtures/demo.paprika.json"}},
		},
		{
			name: "package.json dev serve",
			args: []string{"serve", "--db", "dev.db"},
			want: recorded{"serve", serveOptions{DB: "dev.db", Port: 4777, Host: "127.0.0.1", TeamName: "tester"}},
		},
		{
			name: "package.json start",
			args: []string{"serve"},
			want: recorded{"serve", serveOptions{DB: "paprika.db", Port: 4777, Host: "127.0.0.1", TeamName: "tester"}},
		},
		{
			name: "flags before the positional",
			args: []string{"import", "--db", "x.db", "--replace", "doc.json"},
			want: recorded{"import", importOptions{DB: "x.db", Replace: true, File: "doc.json"}},
		},
		{
			name: "flags after the positional",
			args: []string{"import", "doc.json", "--db=x.db", "--replace"},
			want: recorded{"import", importOptions{DB: "x.db", Replace: true, File: "doc.json"}},
		},
		{
			name: "short port",
			args: []string{"serve", "-p", "9000"},
			want: recorded{"serve", serveOptions{DB: "paprika.db", Port: 9000, Host: "127.0.0.1", TeamName: "tester"}},
		},
		{
			name: "export with root and short out",
			args: []string{"export", "--db", "x.db", "--doc", "d1", "--root", "n1", "-o", "out.json"},
			want: recorded{"export", exportOptions{DB: "x.db", Doc: "d1", Root: "n1", Out: "out.json"}},
		},
		{
			name: "export long out",
			args: []string{"export", "--out", "out.json"},
			want: recorded{"export", exportOptions{DB: "paprika.db", Out: "out.json"}},
		},
		{
			name: "list",
			args: []string{"list", "--db", "x.db"},
			want: recorded{"list", listOptions{DB: "x.db"}},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var rec recorded
			var out, errOut bytes.Buffer
			root := newRootCmd(recordingHandlers(&rec))
			root.SetArgs(c.args)
			root.SetOut(&out)
			root.SetErr(&errOut)
			if err := root.Execute(); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(rec, c.want) {
				t.Errorf("got %+v, want %+v", rec, c.want)
			}
		})
	}
}

func TestVersionForms(t *testing.T) {
	for _, args := range [][]string{{"version"}, {"--version"}, {"-v"}} {
		var out, errOut bytes.Buffer
		if code := execute(args, &out, &errOut); code != 0 {
			t.Fatalf("%v: exit code %d", args, code)
		}
		if got := strings.TrimSpace(out.String()); got == "" || strings.Contains(got, " ") {
			t.Errorf("%v printed %q, want only the version", args, out.String())
		}
	}
}

func TestExitCodes(t *testing.T) {
	fixedEnv(t)
	missing := filepath.Join(t.TempDir(), "missing.paprika.json")
	cases := []struct {
		name       string
		args       []string
		code       int
		stdoutHas  string
		stderrHas  string
		stdoutZero bool
	}{
		{name: "no arguments", args: nil, code: 2, stdoutHas: "Comandos:", stderrHas: ""},
		{name: "unknown command", args: []string{"bogus"}, code: 2, stdoutZero: true, stderrHas: `comando desconhecido "bogus"`},
		{name: "unknown command with suggestion", args: []string{"serv"}, code: 2, stdoutZero: true, stderrHas: "serve"},
		{name: "unknown flag", args: []string{"serve", "--bogus"}, code: 1, stdoutZero: true, stderrHas: "veja paprika --help"},
		{name: "flag of another command", args: []string{"list", "--port", "1"}, code: 1, stdoutZero: true, stderrHas: "veja paprika --help"},
		{name: "flag without value", args: []string{"serve", "--port"}, code: 1, stdoutZero: true, stderrHas: "veja paprika --help"},
		{name: "invalid port", args: []string{"serve", "--port", "70000"}, code: 1, stdoutZero: true, stderrHas: "porta inválida: 70000"},
		{name: "negative port", args: []string{"mcp", "--port=-1", "--no-ui"}, code: 1, stdoutZero: true, stderrHas: "porta inválida: -1"},
		{name: "import without file", args: []string{"import"}, code: 1, stdoutZero: true, stderrHas: "uso: paprika import"},
		{name: "import with two files", args: []string{"import", "a", "b"}, code: 1, stdoutZero: true, stderrHas: "uso: paprika import"},
		{name: "import missing file", args: []string{"import", missing, "--db", filepath.Join(t.TempDir(), "x.db")}, code: 1, stdoutZero: true, stderrHas: "no such file"},
		{name: "help flag", args: []string{"--help"}, code: 0, stdoutHas: "Comandos:"},
		{name: "help command", args: []string{"help", "serve"}, code: 0, stdoutHas: "paprika serve"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var out, errOut bytes.Buffer
			if code := execute(c.args, &out, &errOut); code != c.code {
				t.Fatalf("exit code %d, want %d (stdout %q, stderr %q)", code, c.code, out.String(), errOut.String())
			}
			if c.stdoutZero && out.Len() != 0 {
				t.Errorf("stdout should be empty, got %q", out.String())
			}
			if !strings.Contains(out.String(), c.stdoutHas) {
				t.Errorf("stdout %q does not contain %q", out.String(), c.stdoutHas)
			}
			if !strings.Contains(errOut.String(), c.stderrHas) {
				t.Errorf("stderr %q does not contain %q", errOut.String(), c.stderrHas)
			}
		})
	}
}

func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	orig := os.Stdout
	os.Stdout = w
	done := make(chan string)
	go func() {
		var buf bytes.Buffer
		_, _ = io.Copy(&buf, r)
		done <- buf.String()
	}()
	fn()
	os.Stdout = orig
	w.Close()
	return <-done
}

func TestCompletionScripts(t *testing.T) {
	for _, shell := range []string{"bash", "zsh", "fish"} {
		t.Run(shell, func(t *testing.T) {
			var errOut bytes.Buffer
			var code int
			script := captureStdout(t, func() { code = execute([]string{"completion", shell}, io.Discard, &errOut) })
			if code != 0 {
				t.Fatalf("exit code %d: %s", code, errOut.String())
			}
			if !strings.Contains(script, "paprika") {
				t.Errorf("%s script does not mention paprika", shell)
			}
		})
	}
}

func TestImportListExportWithRealHandlers(t *testing.T) {
	fixedEnv(t)
	dir := t.TempDir()
	db := filepath.Join(dir, "x.db")
	exported := filepath.Join(dir, "out.paprika.json")
	steps := [][]string{
		{"import", "../../../packages/e2e/fixtures/demo.paprika.json", "--db", db},
		{"list", "--db", db},
		{"export", "--db", db, "-o", exported},
	}
	for _, args := range steps {
		var out, errOut bytes.Buffer
		if code := execute(args, &out, &errOut); code != 0 {
			t.Fatalf("%v: exit code %d: %s", args, code, errOut.String())
		}
	}
	if st, err := os.Stat(exported); err != nil || st.Size() == 0 {
		t.Fatalf("export did not write %s: %v", exported, err)
	}
}

func TestBoolFlagHelpAndExplicitValue(t *testing.T) {
	fs := pflag.NewFlagSet("t", pflag.ContinueOnError)
	on := fs.Bool("team", false, "modo time")
	if got := flagUsages(fs); strings.Contains(got, "[=true|false]") || !strings.Contains(got, "--team ") {
		t.Fatalf("usage = %q", got)
	}
	if err := fs.Parse([]string{"--team"}); err != nil || !*on {
		t.Fatalf("--team: on=%v err=%v", *on, err)
	}
	if err := fs.Parse([]string{"--team=false"}); err != nil || *on {
		t.Fatalf("--team=false: on=%v err=%v", *on, err)
	}
}
