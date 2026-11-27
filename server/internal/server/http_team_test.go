package server

import (
	"net/http"
	"testing"
)

func TestTeamStatusWithoutTeamMode(t *testing.T) {
	s, _ := openTemp(t)
	srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	status, body, header := httpDo(t, srv, "GET", "/api/team", nil, "")
	if status != http.StatusNoContent {
		t.Fatalf("GET /api/team without --team = %d, want 204 (a 404 is a console error on every page open)", status)
	}
	if body != "" {
		t.Fatalf("body = %q, want empty", body)
	}
	if ct := header.Get("Content-Type"); ct != "" {
		t.Fatalf("Content-Type = %q: the web client reads a JSON answer as a team status, only a non-JSON one means no team mode", ct)
	}
	if status, _, _ := httpDo(t, srv, "POST", "/api/team", nil, `{"name":"x"}`); status != http.StatusMethodNotAllowed {
		t.Fatalf("POST /api/team without --team = %d, want 405", status)
	}
}
