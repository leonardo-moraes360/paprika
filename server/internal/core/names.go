package core

import "strconv"

func DefaultPageName(index int, lang string) string {
	if lang == "pt-BR" {
		return "Página " + strconv.Itoa(index)
	}
	return "Page " + strconv.Itoa(index)
}

func DefaultUntitledName(lang string) string {
	if lang == "pt-BR" {
		return "Sem título"
	}
	return "Untitled"
}
