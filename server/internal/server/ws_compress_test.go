package server

import (
	"context"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type countingConn struct {
	net.Conn
	read *atomic.Int64
}

func (c countingConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	c.read.Add(int64(n))
	return n, err
}

func TestWSNegotiatesDeflateAndShrinksInitialDoc(t *testing.T) {
	s, srv := startWS(t)
	bigDoc(t, s, 400, 150)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	for _, mode := range []websocket.CompressionMode{websocket.CompressionDisabled, websocket.CompressionContextTakeover} {
		var read atomic.Int64
		client := &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			c, err := (&net.Dialer{}).DialContext(ctx, network, addr)
			if err != nil {
				return nil, err
			}
			return countingConn{Conn: c, read: &read}, nil
		}}}
		c, res, err := websocket.Dial(ctx, strings.Replace(srv.URL, "http", "ws", 1)+"/ws", &websocket.DialOptions{
			HTTPClient: client, HTTPHeader: http.Header{"Origin": {srv.URL}}, CompressionMode: mode,
		})
		if err != nil {
			t.Fatal(err)
		}
		c.SetReadLimit(-1)
		ext := res.Header.Get("Sec-WebSocket-Extensions")
		if mode == websocket.CompressionDisabled && ext != "" {
			t.Fatalf("extension negotiated without client offer: %q", ext)
		}
		if mode != websocket.CompressionDisabled && !strings.Contains(ext, "permessage-deflate") {
			t.Fatalf("permessage-deflate not negotiated: %q", ext)
		}
		var docLen int
		for docLen == 0 {
			msg, n, err := readMsg(t, ctx, c)
			if err != nil {
				t.Fatal(err)
			}
			if msg.Str("type") == "doc" {
				if got := len(msg.Obj("doc").Obj("nodes").Keys()); got != 400 {
					t.Fatalf("doc has %d nodes, want 400", got)
				}
				docLen = n
			}
		}
		wire := read.Load()
		c.CloseNow()
		if mode == websocket.CompressionDisabled && wire < int64(docLen) {
			t.Fatalf("uncompressed wire %d below doc size %d", wire, docLen)
		}
		if mode != websocket.CompressionDisabled && wire*4 > int64(docLen) {
			t.Fatalf("compressed wire %d not under a quarter of doc size %d", wire, docLen)
		}
	}
}
