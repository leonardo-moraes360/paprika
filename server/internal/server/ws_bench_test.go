package server

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/coder/websocket"
	"github.com/leonardo-moraes360/paprika/server/internal/jsonv"
)

func BenchmarkBroadcast(b *testing.B) {
	for _, conns := range []int{1, 4, 16} {
		b.Run(fmt.Sprintf("conns=%d", conns), func(b *testing.B) {
			s, err := OpenStore(filepath.Join(b.TempDir(), "b.db"), OpenOptions{Poll: -1})
			if err != nil {
				b.Fatal(err)
			}
			defer s.Close()
			pad := strings.Repeat("x", 150)
			var seed []any
			for i := range 2500 {
				op, _ := jsonv.Parse([]byte(fmt.Sprintf(`{"op":"create","node":{"type":"rect","id":"t%d","name":"%s"}}`, i, pad)))
				seed = append(seed, op)
			}
			if _, err := s.Apply(seed, "user", "seed"); err != nil {
				b.Fatal(err)
			}
			srv, err := StartHTTP(s, HTTPOptions{Host: "127.0.0.1", Port: 0})
			if err != nil {
				b.Fatal(err)
			}
			defer srv.Close()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			for range conns {
				c, _, err := websocket.Dial(ctx, strings.Replace(srv.URL, "http", "ws", 1)+"/ws", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {srv.URL}}})
				if err != nil {
					b.Fatal(err)
				}
				c.SetReadLimit(-1)
				go func() {
					for {
						if _, _, err := c.Read(ctx); err != nil {
							return
						}
					}
				}()
			}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				op, _ := jsonv.Parse([]byte(fmt.Sprintf(`{"op":"update","id":"t0","props":{"opacity":%v}}`, 0.1+float64(i%8)/10)))
				if _, err := s.Apply([]any{op}, "agent:bench", "w"); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
