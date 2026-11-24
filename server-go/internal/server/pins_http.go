package server

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/leonardo-moraes360/paprika/server-go/internal/jsonv"
	z "github.com/leonardo-moraes360/paprika/server-go/internal/zod"
)

var pinRegionSchema = z.Object(
	z.Field{Name: "x", Schema: z.Number()},
	z.Field{Name: "y", Schema: z.Number()},
	z.Field{Name: "width", Schema: z.Number().Min(0)},
	z.Field{Name: "height", Schema: z.Number().Min(0)},
)

// POST /api/pins: a pin made on the canvas.
var newPinBody = z.Object(
	z.Field{Name: "workspaceId", Schema: z.Optional(z.String().Min(1))},
	z.Field{Name: "pageId", Schema: z.Optional(z.String())},
	z.Field{Name: "nodeId", Schema: z.Optional(z.String())},
	z.Field{Name: "region", Schema: pinRegionSchema},
	z.Field{Name: "text", Schema: z.String().Min(1).Max(MaxPinText)},
)

// PATCH /api/pins/{id}: reopen, resolve (by the human) or edit the text.
var patchPinBody = z.Object(
	z.Field{Name: "status", Schema: z.Optional(z.Enum(PinOpen, PinResolved))},
	z.Field{Name: "text", Schema: z.Optional(z.String().Min(1).Max(MaxPinText))},
	z.Field{Name: "reply", Schema: z.Optional(z.String().Max(MaxPinReply))},
)

func regionOf(o *jsonv.Object) PinRegion {
	return PinRegion{X: o.Num("x"), Y: o.Num("y"), Width: o.Num("width"), Height: o.Num("height")}
}

// pinError maps a store error to an HTTP status.
func pinError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNoPin), errors.Is(err, ErrNoWorkspace):
		send(w, 404, errBody(err.Error()), "")
	case errors.Is(err, ErrPinInput):
		send(w, 400, errBody(err.Error()), "")
	case errors.Is(err, ErrPinClaimed), errors.Is(err, ErrPinResolved):
		send(w, 409, errBody(err.Error()), "")
	default:
		send(w, 500, errBody(err.Error()), "")
	}
}

func parseBody(c *gin.Context, schema *z.ObjectSchema) (*jsonv.Object, bool) {
	body, present, err := readBody(c.Request)
	if err != nil {
		if he, ok := errors.AsType[*httpError](err); ok {
			send(c.Writer, he.status, errBody(he.msg), "")
			return nil, false
		}
		send(c.Writer, 500, errBody(err.Error()), "")
		return nil, false
	}
	if !present {
		body = jsonv.NewObject()
	}
	parsed, err := z.Parse(schema, body)
	if err != nil {
		send(c.Writer, 400, errBody(err.Error()), "")
		return nil, false
	}
	return parsed.(*jsonv.Object), true
}

// registerPinRoutes serves /api/pins for the canvas. The canvas acts as "user".
func registerPinRoutes(engine *gin.Engine, store *Store) {
	engine.Any("/api/pins", func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet:
			pins, err := store.ListPins(PinFilter{WorkspaceID: c.Query("workspaceId"), Status: c.DefaultQuery("status", "all")})
			if err != nil {
				pinError(c.Writer, err)
				return
			}
			send(c.Writer, 200, jsonv.NewObject("pins", jsonv.FromGo(pins), "rev", float64(store.PinsRev())), "")
		case http.MethodPost:
			b, ok := parseBody(c, newPinBody)
			if !ok {
				return
			}
			pin, err := store.CreatePin(b.Str("workspaceId"), NewPin{PageID: b.Str("pageId"), NodeID: b.Str("nodeId"), Region: regionOf(b.Obj("region")), Text: b.Str("text")}, "user")
			if err != nil {
				pinError(c.Writer, err)
				return
			}
			send(c.Writer, 201, jsonv.NewObject("pin", jsonv.FromGo(pin)), "")
		default:
			send(c.Writer, 405, errBody("method not allowed"), "")
		}
	})
	engine.Any("/api/pins/:id/replies", func(c *gin.Context) {
		if c.Request.Method != http.MethodPost {
			send(c.Writer, 405, errBody("method not allowed"), "")
			return
		}
		b, ok := parseBody(c, z.Object(z.Field{Name: "text", Schema: z.String().Min(1).Max(MaxPinReply)}))
		if !ok {
			return
		}
		pin, err := store.ReplyPin(c.Param("id"), "user", b.Str("text"))
		if err != nil {
			pinError(c.Writer, err)
			return
		}
		send(c.Writer, 201, jsonv.NewObject("pin", jsonv.FromGo(pin)), "")
	})
	engine.Any("/api/pins/:id", func(c *gin.Context) {
		id := c.Param("id")
		switch c.Request.Method {
		case http.MethodGet:
			pin, err := store.GetPin(id)
			if err == nil && pin.Status == PinDeleted {
				err = ErrNoPin
			}
			if err != nil {
				pinError(c.Writer, err)
				return
			}
			send(c.Writer, 200, jsonv.NewObject("pin", jsonv.FromGo(pin)), "")
		case http.MethodPatch:
			b, ok := parseBody(c, patchPinBody)
			if !ok {
				return
			}
			var pin Pin
			var err error
			switch b.Str("status") {
			case PinOpen:
				pin, err = store.ReopenPin(id)
			case PinResolved:
				reply := strings.TrimSpace(b.Str("reply"))
				if reply == "" {
					reply = "resolved by the human"
				}
				pin, err = store.ResolvePin(id, "user", reply)
			default:
				if !b.Has("text") {
					send(c.Writer, 400, errBody("pass status or text"), "")
					return
				}
				pin, err = store.EditPin(id, b.Str("text"))
			}
			if err != nil {
				pinError(c.Writer, err)
				return
			}
			send(c.Writer, 200, jsonv.NewObject("pin", jsonv.FromGo(pin)), "")
		case http.MethodDelete:
			pin, err := store.DeletePin(id)
			if err != nil {
				pinError(c.Writer, err)
				return
			}
			send(c.Writer, 200, jsonv.NewObject("deleted", pin.ID), "")
		default:
			send(c.Writer, 405, errBody("method not allowed"), "")
		}
	})
}

// broadcastPins tells the WebSocket clients that pins changed ({type:"pins", rev}); the canvas reads
// /api/pins again. It polls the table because another process (`paprika mcp`) may write it.
func broadcastPins(store *Store, hub *wsHub) func() {
	last := store.PinsRev()
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(pinsWaitPoll)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
			}
			rev := store.PinsRev()
			if rev == last {
				continue
			}
			last = rev
			msg := jsonv.Stringify(jsonv.NewObject("type", "pins", "rev", float64(rev)), "")
			hub.mu.Lock()
			for _, ch := range hub.conns {
				select {
				case ch <- msg:
				default:
				}
			}
			hub.mu.Unlock()
		}
	}()
	var once sync.Once
	return func() { once.Do(func() { close(stop) }) }
}
