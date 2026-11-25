package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/leonardo-moraes360/paprika/server/internal/server"
	"github.com/leonardo-moraes360/paprika/server/internal/team"
)

type serveOptions struct {
	DB          string
	Doc         string
	Port        int
	Host        string
	Web         string
	Team        bool
	TeamDir     string
	TeamName    string
	TeamNoRelay bool
	TeamBind    string
}

type mcpOptions struct {
	DB   string
	Doc  string
	Port int
	Host string
	Web  string
	NoUI bool
}

func newServeCmd(h handlers) *cobra.Command {
	var o serveOptions
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Sobe o canvas, a API HTTP, o MCP via HTTP e o sync ao vivo",
		Long: "Canvas em http://host:port, MCP Streamable HTTP em /mcp, sync ao vivo em /ws.\n" +
			"Com --team, sobe o sidecar paprika-sync e sincroniza com o time P2P (docs/team-sync.md).",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validPort(o.Port); err != nil {
				return err
			}
			return h.serve(o)
		},
	}
	addDBFlag(cmd, &o.DB)
	addDocFlag(cmd, &o.Doc)
	addUIFlags(cmd, &o.Port, &o.Host, &o.Web)
	cmd.Flags().BoolVar(&o.Team, "team", false, "Entra no modo time: Iroh + CRDT via sidecar paprika-sync ($PAPRIKA_SYNC ou ao lado do binário)")
	cmd.Flags().StringVar(&o.TeamDir, "team-dir", "", "Pasta da chave, do arquivo de time e do log de operações; sem ela, <db>.team/")
	cmd.Flags().StringVar(&o.TeamName, "team-name", os.Getenv("USER"), "Seu nome para o time; o padrão vem de $USER")
	cmd.Flags().BoolVar(&o.TeamNoRelay, "team-no-relay", false, "Sem relays públicos nem busca de endereço (só rede local; testes)")
	cmd.Flags().StringVar(&o.TeamBind, "team-bind", "", "Endereço UDP do endpoint Iroh (ex.: 127.0.0.1:0)")
	return cmd
}

func newMCPCmd(h handlers) *cobra.Command {
	var o mcpOptions
	cmd := &cobra.Command{
		Use:   "mcp",
		Short: "Serve o MCP via stdio (para agentes que só falam stdio)",
		Long:  "MCP via stdio (para agentes que só falam stdio). Sobe o canvas na porta, se livre.",
		RunE: func(cmd *cobra.Command, args []string) error {
			if err := validPort(o.Port); err != nil {
				return err
			}
			return h.mcp(o)
		},
	}
	addDBFlag(cmd, &o.DB)
	addDocFlag(cmd, &o.Doc)
	addUIFlags(cmd, &o.Port, &o.Host, &o.Web)
	cmd.Flags().BoolVar(&o.NoUI, "no-ui", false, "Não sobe o canvas HTTP")
	return cmd
}

type serverRun struct {
	store    *server.Store
	shot     *server.Chrome
	teamSvc  *team.Service
	teamHTTP server.TeamRoutes
	http     *server.RunningServer
	host     string
	port     int
	web      string
}

func (r *serverRun) startUI() error {
	var err error
	r.http, err = server.StartHTTP(r.store, server.HTTPOptions{Host: r.host, Port: r.port, WebRoot: webRoot(r.web), Log: logf, Shot: r.shot, Team: r.teamHTTP})
	if err != nil {
		return err
	}
	logf(fmt.Sprintf("canvas: %s  ·  MCP HTTP: %s/mcp", r.http.URL, r.http.URL))
	return nil
}

func (r *serverRun) shutdown() {
	if r.http != nil {
		r.http.Close()
	}
	if r.teamSvc != nil {
		r.teamSvc.Close()
	}
	r.shot.Close()
	r.store.Close()
}

func openRun(db, doc, host, web string, port int) (*serverRun, string, error) {
	dbPath, _ := filepath.Abs(db)
	store, err := server.OpenStore(dbPath, server.OpenOptions{DocID: doc})
	if err != nil {
		return nil, dbPath, err
	}
	store.OnError(func(e error) { logf(e.Error()) })
	logf(fmt.Sprintf("banco: %s · documento %q (%s)", dbPath, store.Doc().Str("name"), store.DocID()))
	return &serverRun{store: store, shot: &server.Chrome{}, host: host, port: port, web: web}, dbPath, nil
}

func runServe(o serveOptions) error {
	r, dbPath, err := openRun(o.DB, o.Doc, o.Host, o.Web, o.Port)
	if err != nil {
		return err
	}
	if o.Team {
		dir := o.TeamDir
		if dir == "" {
			dir = strings.TrimSuffix(dbPath, filepath.Ext(dbPath)) + ".team"
		}
		r.teamSvc, err = team.New(context.Background(), r.store, team.Options{DataDir: dir, Name: o.TeamName, NoRelay: o.TeamNoRelay, Bind: o.TeamBind, Stderr: os.Stderr}, logf)
		if err != nil {
			r.store.Close()
			return fmt.Errorf("time: %w", err)
		}
		r.teamHTTP = r.teamSvc
		logf(fmt.Sprintf("time: chave %s · dados em %s", r.teamSvc.Sidecar().ID, dir))
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if o.Host != "127.0.0.1" && o.Host != "localhost" {
		logf("AVISO: exposto fora do loopback e sem autenticação.")
	}
	if err := r.startUI(); err != nil {
		return err
	}
	<-ctx.Done()
	r.shutdown()
	return nil
}

func runMCP(o mcpOptions) error {
	r, _, err := openRun(o.DB, o.Doc, o.Host, o.Web, o.Port)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if !o.NoUI {
		if err := r.startUI(); err != nil {
			if strings.Contains(err.Error(), "address already in use") {
				logf(fmt.Sprintf("porta %d ocupada; seguindo sem canvas (o banco continua sincronizado)", o.Port))
			} else {
				logf("canvas indisponível: " + err.Error())
			}
		}
	}
	done := make(chan error, 1)
	go func() {
		done <- server.ServeStdio(ctx, server.NewMCP(r.store, "agent:stdio", r.shot), os.Stdin, os.Stdout)
	}()
	select {
	case err = <-done:
	case <-ctx.Done():
	}
	r.shutdown()
	return err
}
