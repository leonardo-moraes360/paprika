// Command paprika is the Go Paprika server: a local design tool for AI agents with a built-in
// MCP server, storing documents in SQLite.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	"github.com/leonardo-moraes360/paprika/server-go/internal/server"
)

const help = `paprika %s (Go): ferramenta de design local para agentes de IA, com MCP embutido e dados em SQLite.

Uso:
  paprika serve  [--db paprika.db] [--doc ID] [--port 4777] [--host 127.0.0.1] [--web DIR]
      Canvas em http://host:port, MCP Streamable HTTP em /mcp, sync ao vivo em /ws.
  paprika mcp    [--db paprika.db] [--doc ID] [--port 4777] [--no-ui]
      MCP via stdio (para agentes que só falam stdio). Sobe o canvas na porta, se livre.
  paprika import ARQUIVO.paprika.json [--db paprika.db] [--replace]
      Importa um documento .paprika.json para o banco (imprime o id).
  paprika export [--db paprika.db] [--doc ID] [-o ARQUIVO]
      Exporta o documento como .paprika.json (stdout sem -o), para versionar no git.
  paprika list   [--db paprika.db]
      Lista os documentos do banco.

Opções:
      --db      Banco SQLite (criado se não existir). Padrão: ./paprika.db ou $PAPRIKA_DB
      --doc     Id do documento. Padrão: o atualizado mais recentemente (um vazio é criado se o banco estiver vazio)
                Os documentos do banco são os workspaces da página inicial (/).
  -p, --port    Porta HTTP. Padrão: 4777 (0 = aleatória)
      --host    Interface de bind. Padrão: 127.0.0.1. Expor fora do loopback não tem autenticação.
      --web     Build do canvas (apps/web/dist). Padrão: $PAPRIKA_WEB_ROOT ou detectado
      --no-ui   (mcp) não sobe o canvas HTTP
  -h, --help
  -v, --version
`

func logf(m string) { fmt.Fprintf(os.Stderr, "[paprika] %s\n", m) }

func webRoot(flagValue string) string {
	candidates := []string{flagValue, os.Getenv("PAPRIKA_WEB_ROOT")}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates, filepath.Join(dir, "web"), filepath.Join(dir, "../apps/web/dist"), filepath.Join(dir, "../../apps/web/dist"))
	}
	candidates = append(candidates, "apps/web/dist", "../apps/web/dist")
	for _, c := range candidates {
		if c == "" {
			continue
		}
		if st, err := os.Stat(filepath.Join(c, "index.html")); err == nil && !st.IsDir() {
			return c
		}
	}
	return ""
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		var ue usageError
		if errors.As(err, &ue) {
			fmt.Fprintf(os.Stdout, help, server.Version)
			os.Exit(2)
		}
		fmt.Fprintf(os.Stderr, "[paprika] erro: %s\n", err)
		os.Exit(1)
	}
}

type usageError struct{}

func (usageError) Error() string { return "uso" }

func run(args []string) error {
	if len(args) == 0 {
		return usageError{}
	}
	switch args[0] {
	case "-h", "--help", "help":
		fmt.Fprintf(os.Stdout, help, server.Version)
		return nil
	case "-v", "--version", "version":
		fmt.Println(server.Version)
		return nil
	}
	cmd := args[0]
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	defaultDB := os.Getenv("PAPRIKA_DB")
	if defaultDB == "" {
		defaultDB = "paprika.db"
	}
	db := fs.String("db", defaultDB, "")
	doc := fs.String("doc", "", "")
	port := fs.Int("port", 4777, "")
	fs.IntVar(port, "p", 4777, "")
	host := fs.String("host", "127.0.0.1", "")
	web := fs.String("web", "", "")
	noUI := fs.Bool("no-ui", false, "")
	replace := fs.Bool("replace", false, "")
	out := fs.String("o", "", "")
	fs.StringVar(out, "out", "", "")
	// Accept flags before and after positionals (`import file --db x` and `import --db x file`).
	var positionals []string
	rest := args[1:]
	for {
		if err := fs.Parse(rest); err != nil {
			return fmt.Errorf("%v (veja paprika --help)", err)
		}
		if fs.NArg() == 0 {
			break
		}
		positionals = append(positionals, fs.Arg(0))
		rest = fs.Args()[1:]
	}
	if *port < 0 || *port > 65535 {
		return fmt.Errorf("porta inválida: %d", *port)
	}
	dbPath, _ := filepath.Abs(*db)

	switch cmd {
	case "import":
		if len(positionals) != 1 {
			return errors.New("uso: paprika import ARQUIVO.paprika.json [--db paprika.db] [--replace]")
		}
		raw, err := os.ReadFile(positionals[0])
		if err != nil {
			return err
		}
		conn, err := server.OpenDB(dbPath)
		if err != nil {
			return err
		}
		defer conn.Close()
		d, err := server.ImportDocument(conn, raw, *replace)
		if err != nil {
			return fmt.Errorf("%s: %w", positionals[0], err)
		}
		logf(fmt.Sprintf("importado %q (%d nós) em %s", d.Str("name"), d.Obj("nodes").Len(), dbPath))
		fmt.Println(d.Str("id"))
		return nil
	case "export":
		conn, err := server.OpenDB(dbPath)
		if err != nil {
			return err
		}
		defer conn.Close()
		id := *doc
		if id == "" {
			docs, err := server.ListDocuments(conn)
			if err != nil {
				return err
			}
			if len(docs) == 0 {
				return fmt.Errorf("nenhum documento em %s", dbPath)
			}
			id = docs[0].ID
		}
		text, err := server.ExportDocument(conn, id)
		if err != nil {
			return err
		}
		if *out == "" {
			_, err = io.WriteString(os.Stdout, text)
			return err
		}
		tmp := *out + ".tmp"
		if err := os.WriteFile(tmp, []byte(text), 0o644); err != nil {
			return err
		}
		return os.Rename(tmp, *out)
	case "list":
		conn, err := server.OpenDB(dbPath)
		if err != nil {
			return err
		}
		defer conn.Close()
		docs, err := server.ListDocuments(conn)
		if err != nil {
			return err
		}
		fmt.Println(jsonv.Stringify(jsonv.FromGo(docs), "  "))
		return nil
	case "serve", "mcp":
	default:
		return usageError{}
	}

	store, err := server.OpenStore(dbPath, server.OpenOptions{DocID: *doc})
	if err != nil {
		return err
	}
	store.OnError(func(e error) { logf(e.Error()) })
	logf(fmt.Sprintf("banco: %s · documento %q (%s)", dbPath, store.Doc().Str("name"), store.DocID()))
	shot := &server.Chrome{}

	var http *server.RunningServer
	startUI := func() error {
		var err error
		http, err = server.StartHTTP(store, server.HTTPOptions{Host: *host, Port: *port, WebRoot: webRoot(*web), Log: logf, Shot: shot})
		if err != nil {
			return err
		}
		logf(fmt.Sprintf("canvas: %s  ·  MCP HTTP: %s/mcp", http.URL, http.URL))
		return nil
	}
	shutdown := func() {
		if http != nil {
			http.Close()
		}
		shot.Close()
		store.Close()
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if cmd == "serve" {
		if *host != "127.0.0.1" && *host != "localhost" {
			logf("AVISO: exposto fora do loopback e sem autenticação.")
		}
		if err := startUI(); err != nil {
			return err
		}
		<-ctx.Done()
		shutdown()
		return nil
	}

	if !*noUI {
		if err := startUI(); err != nil {
			if strings.Contains(err.Error(), "address already in use") {
				logf(fmt.Sprintf("porta %d ocupada; seguindo sem canvas (o banco continua sincronizado)", *port))
			} else {
				logf("canvas indisponível: " + err.Error())
			}
		}
	}
	// stdio mode: stdout is the MCP channel, every log goes to stderr.
	done := make(chan error, 1)
	go func() { done <- server.ServeStdio(ctx, server.NewMCP(store, "agent:stdio", shot), os.Stdin, os.Stdout) }()
	select {
	case err = <-done:
	case <-ctx.Done():
	}
	shutdown()
	return err
}
