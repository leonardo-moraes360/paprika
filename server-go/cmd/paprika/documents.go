package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"

	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	"github.com/leonardo-moraes360/paprika/server-go/internal/server"
)

type importOptions struct {
	DB      string
	Replace bool
	File    string
}

type exportOptions struct {
	DB   string
	Doc  string
	Root string
	Out  string
}

type listOptions struct {
	DB string
}

func newImportCmd(h handlers) *cobra.Command {
	var o importOptions
	cmd := &cobra.Command{
		Use:   "import ARQUIVO.paprika.json",
		Short: "Importa um documento .paprika.json para o banco",
		Long:  "Importa um documento .paprika.json para o banco (imprime o id).",
		Args: func(cmd *cobra.Command, args []string) error {
			if len(args) != 1 {
				return errors.New("uso: paprika import ARQUIVO.paprika.json [--db paprika.db] [--replace]")
			}
			return nil
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			o.File = args[0]
			return h.importFile(o)
		},
	}
	addDBFlag(cmd, &o.DB)
	cmd.Flags().BoolVar(&o.Replace, "replace", false, "Substitui o documento que já existe com o mesmo id")
	return cmd
}

func newExportCmd(h handlers) *cobra.Command {
	var o exportOptions
	cmd := &cobra.Command{
		Use:   "export",
		Short: "Exporta o documento como .paprika.json",
		Long: "Exporta o documento como .paprika.json (stdout sem -o), para versionar no git.\n" +
			"Com --root, exporta só aquele frame (ou group/page) como documento autônomo: a subtree,\n" +
			"os componentes das instâncias, os tokens e modos que eles usam; conectores que apontam\n" +
			"para fora são descartados (aviso no stderr). Para abrir em outro servidor: import_document.",
		RunE: func(cmd *cobra.Command, args []string) error {
			return h.export(o)
		},
	}
	addDBFlag(cmd, &o.DB)
	addDocFlag(cmd, &o.Doc)
	cmd.Flags().StringVar(&o.Root, "root", "", "Exporta só este frame (ou group/page) como documento autônomo")
	cmd.Flags().StringVarP(&o.Out, "out", "o", "", "Arquivo de saída; sem ele, stdout")
	return cmd
}

func newListCmd(h handlers) *cobra.Command {
	var o listOptions
	cmd := &cobra.Command{
		Use:   "list",
		Short: "Lista os documentos do banco",
		RunE: func(cmd *cobra.Command, args []string) error {
			return h.list(o)
		},
	}
	addDBFlag(cmd, &o.DB)
	return cmd
}

func runImport(o importOptions) error {
	dbPath, _ := filepath.Abs(o.DB)
	raw, err := os.ReadFile(o.File)
	if err != nil {
		return err
	}
	conn, err := server.OpenDB(dbPath)
	if err != nil {
		return err
	}
	defer conn.Close()
	d, err := server.ImportDocument(conn, raw, o.Replace)
	if err != nil {
		return fmt.Errorf("%s: %w", o.File, err)
	}
	logf(fmt.Sprintf("importado %q (%d nós) em %s", d.Str("name"), d.Obj("nodes").Len(), dbPath))
	fmt.Println(d.Str("id"))
	return nil
}

func runExport(o exportOptions) error {
	dbPath, _ := filepath.Abs(o.DB)
	conn, err := server.OpenDB(dbPath)
	if err != nil {
		return err
	}
	defer conn.Close()
	id := o.Doc
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
	var text string
	if o.Root != "" {
		var warns []string
		text, warns, err = server.ExportFrame(conn, id, o.Root)
		if err != nil {
			return err
		}
		for _, w := range warns {
			logf(w)
		}
	} else if text, err = server.ExportDocument(conn, id); err != nil {
		return err
	}
	if o.Out == "" {
		_, err = io.WriteString(os.Stdout, text)
		return err
	}
	tmp := o.Out + ".tmp"
	if err := os.WriteFile(tmp, []byte(text), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, o.Out)
}

func runList(o listOptions) error {
	dbPath, _ := filepath.Abs(o.DB)
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
}
