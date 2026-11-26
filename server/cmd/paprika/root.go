package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"

	"github.com/leonardo-moraes360/paprika/server/internal/server"
)

const usageTemplate = `Uso:{{if .Runnable}}
  {{.UseLine}}{{end}}{{if .HasAvailableSubCommands}}
  {{.CommandPath}} [comando]{{end}}{{if .HasAvailableSubCommands}}

Comandos:{{range .Commands}}{{if (or .IsAvailableCommand (eq .Name "help"))}}
  {{rpad .Name .NamePadding }} {{.Short}}{{end}}{{end}}{{end}}{{if .HasAvailableLocalFlags}}

Opções:
{{flagUsages .LocalFlags | trimTrailingWhitespaces}}{{end}}{{if .HasAvailableSubCommands}}

Use "{{.CommandPath}} [comando] --help" para saber mais sobre um comando.{{end}}
`

func init() {
	cobra.AddTemplateFunc("flagUsages", flagUsages)
}

type plainBool struct{ pflag.Value }

func flagUsages(fs *pflag.FlagSet) string {
	out := pflag.NewFlagSet(fs.Name(), pflag.ContinueOnError)
	out.SortFlags = fs.SortFlags
	fs.VisitAll(func(f *pflag.Flag) {
		c := *f
		if c.Value.Type() == "bool" {
			c.Value = plainBool{f.Value}
		}
		out.AddFlag(&c)
	})
	return out.FlagUsages()
}

type handlers struct {
	serve      func(serveOptions) error
	mcp        func(mcpOptions) error
	importFile func(importOptions) error
	export     func(exportOptions) error
	list       func(listOptions) error
}

func defaultHandlers() handlers {
	return handlers{serve: runServe, mcp: runMCP, importFile: runImport, export: runExport, list: runList}
}

func defaultDB() string {
	if db := os.Getenv("PAPRIKA_DB"); db != "" {
		return db
	}
	return "paprika.db"
}

func addDBFlag(cmd *cobra.Command, db *string) {
	cmd.Flags().StringVar(db, "db", defaultDB(), "Banco SQLite (criado se não existir); o padrão vem de $PAPRIKA_DB")
}

func addDocFlag(cmd *cobra.Command, doc *string) {
	cmd.Flags().StringVar(doc, "doc", "", "Id do documento; sem ele, o atualizado mais recentemente (um vazio é criado se o banco estiver vazio). Os documentos do banco são os workspaces da página inicial (/)")
}

func addUIFlags(cmd *cobra.Command, port *int, host, web *string) {
	cmd.Flags().IntVarP(port, "port", "p", 4777, "Porta HTTP (0 = aleatória)")
	cmd.Flags().StringVar(host, "host", "127.0.0.1", "Interface de bind. Expor fora do loopback não tem autenticação")
	cmd.Flags().StringVar(web, "web", "", "Build do canvas (web-legacy/dist); sem ele, $PAPRIKA_WEB_ROOT ou detectado")
}

func validPort(port int) error {
	if port < 0 || port > 65535 {
		return fmt.Errorf("porta inválida: %d", port)
	}
	return nil
}

func newRootCmd(h handlers) *cobra.Command {
	root := &cobra.Command{
		Use:     "paprika",
		Short:   "Ferramenta de design local para agentes de IA",
		Long:    fmt.Sprintf("paprika %s (Go): ferramenta de design local para agentes de IA, com MCP embutido e dados em SQLite.", server.Version),
		Version: server.Version,
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return nil
			}
			msg := fmt.Sprintf("comando desconhecido %q (veja paprika --help)", args[0])
			if suggestions := cmd.SuggestionsFor(args[0]); len(suggestions) > 0 {
				msg = fmt.Sprintf("comando desconhecido %q; quis dizer %s? (veja paprika --help)", args[0], strings.Join(suggestions, ", "))
			}
			return usageError{message: msg}
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			return usageError{}
		},
		SilenceErrors: true,
		SilenceUsage:  true,
	}
	root.SetVersionTemplate("{{.Version}}\n")
	root.SetUsageTemplate(usageTemplate)
	root.SetFlagErrorFunc(func(cmd *cobra.Command, err error) error {
		return fmt.Errorf("%v (veja paprika --help)", err)
	})
	root.SetHelpCommand(&cobra.Command{
		Use:   "help [comando]",
		Short: "Mostra a ajuda de um comando",
		Run: func(cmd *cobra.Command, args []string) {
			target, _, err := cmd.Root().Find(args)
			if target == nil || err != nil {
				fmt.Fprintf(cmd.OutOrStdout(), "tópico de ajuda desconhecido: %q\n", args)
				_ = cmd.Root().Usage()
				return
			}
			_ = target.Help()
		},
	})
	root.AddCommand(
		newServeCmd(h),
		newMCPCmd(h),
		newImportCmd(h),
		newExportCmd(h),
		newListCmd(h),
		newVersionCmd(),
	)
	root.InitDefaultCompletionCmd()
	localize(root)
	return root
}

func newVersionCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Mostra a versão",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Fprintln(cmd.OutOrStdout(), server.Version)
		},
	}
}

func localize(root *cobra.Command) {
	shells := map[string]string{
		"bash": "Gera o script de autocompletar para o bash",
		"zsh":  "Gera o script de autocompletar para o zsh",
		"fish": "Gera o script de autocompletar para o fish",
	}
	for _, c := range root.Commands() {
		if c.Name() != "completion" {
			continue
		}
		c.Short = "Gera o script de autocompletar para o shell"
		c.Long = "Gera o script de autocompletar do paprika para bash, zsh ou fish."
		for _, sub := range c.Commands() {
			short, ok := shells[sub.Name()]
			if !ok {
				c.RemoveCommand(sub)
				continue
			}
			sub.Short = short
			sub.Long = short + "."
		}
	}
	walk(root, func(c *cobra.Command) {
		c.InitDefaultHelpFlag()
		if f := c.Flags().Lookup("help"); f != nil {
			f.Usage = "Mostra a ajuda"
		}
		if f := c.Flags().Lookup("no-descriptions"); f != nil {
			f.Usage = "Desativa as descrições do autocompletar"
		}
	})
	root.InitDefaultVersionFlag()
	if f := root.Flags().Lookup("version"); f != nil {
		f.Usage = "Mostra a versão"
	}
}

func walk(c *cobra.Command, fn func(*cobra.Command)) {
	fn(c)
	for _, sub := range c.Commands() {
		walk(sub, fn)
	}
}
