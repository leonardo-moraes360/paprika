package core

import "strconv"

// DefaultPageName returns the localized default page label for a 1-based index.
// Agent/MCP path uses English ("Page 1"); the web UI passes an explicit name.
func DefaultPageName(index int, lang string) string {
	if lang == "pt-BR" {
		return "Página " + strconv.Itoa(index)
	}
	return "Page " + strconv.Itoa(index)
}

// DefaultUntitledName returns the blank workspace/document name.
// Agent/HTTP path uses English ("Untitled"); the web UI can send a localized name.
func DefaultUntitledName(lang string) string {
	if lang == "pt-BR" {
		return "Sem título"
	}
	return "Untitled"
}
