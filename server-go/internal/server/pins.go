package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/leonardo-moraes360/paprika/server-go/internal/core"
)

// Pins ("Apontar para a IA"): a human points at a node or an area of the canvas and writes what an agent
// should do there. A pin is not a node: it lives in its own table, outside the document, so it is not
// exported, not in the design's undo history and not synced as part of the document. Agents read pins over
// MCP (list_pins, claim_pin, resolve_pin, wait_for_pins); the canvas over /api/pins and a {type:"pins"}
// WebSocket message.

const pinsSQL = `
CREATE TABLE IF NOT EXISTS pins (
  id          TEXT PRIMARY KEY,
  doc_id      TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  n           INTEGER NOT NULL,           -- number shown on the pin, per workspace
  page_id     TEXT NOT NULL DEFAULT '',   -- page the pin is on ('' when the document has no pages)
  node_id     TEXT NOT NULL DEFAULT '',   -- target node ('' for an area)
  region      TEXT NOT NULL,              -- JSON {x,y,width,height} in canvas coordinates
  text        TEXT NOT NULL,
  author      TEXT NOT NULL,              -- "user" (canvas, HTTP API) or "agent:<name>"
  status      TEXT NOT NULL CHECK (status IN ('open', 'claimed', 'resolved', 'deleted')),
  claimed_by  TEXT NOT NULL DEFAULT '',
  reply       TEXT NOT NULL DEFAULT '',
  resolved_by TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,           -- Unix ms
  updated_at  INTEGER NOT NULL,           -- Unix ms
  rev         INTEGER NOT NULL            -- global change counter: what wait_for_pins and /ws follow
);
CREATE INDEX IF NOT EXISTS pins_doc ON pins(doc_id, status);
CREATE INDEX IF NOT EXISTS pins_rev ON pins(rev);
`

// Pin statuses.
const (
	PinOpen     = "open"
	PinClaimed  = "claimed"
	PinResolved = "resolved"
	PinDeleted  = "deleted"
)

// Limits of a pin's text and of an agent's reply.
const (
	MaxPinText  = 2000
	MaxPinReply = 2000
)

// PinRegion is a box in canvas coordinates.
type PinRegion struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// Pin is one request from a human to the agents, anchored to a node or an area.
type Pin struct {
	ID          string    `json:"id"`
	N           int       `json:"n"`
	WorkspaceID string    `json:"workspaceId"`
	PageID      string    `json:"pageId,omitempty"`
	NodeID      string    `json:"nodeId,omitempty"`
	NodeName    string    `json:"nodeName,omitempty"`
	NodeMissing bool      `json:"nodeMissing,omitempty"`
	Region      PinRegion `json:"region"`
	Text        string    `json:"text"`
	Author      string    `json:"author"`
	Status      string    `json:"status"`
	ClaimedBy   string    `json:"claimedBy,omitempty"`
	Reply       string    `json:"reply,omitempty"`
	ResolvedBy  string    `json:"resolvedBy,omitempty"`
	CreatedAt   int64     `json:"createdAt"`
	UpdatedAt   int64     `json:"updatedAt"`
	Rev         int64     `json:"rev"`
}

// Pin errors.
var (
	ErrNoPin       = errors.New("pin not found")
	ErrPinClaimed  = errors.New("pin claimed by another agent")
	ErrPinResolved = errors.New("pin already resolved")
	ErrPinInput    = errors.New("invalid pin")
)

// NewPin is what the canvas sends to create a pin.
type NewPin struct {
	PageID string
	NodeID string
	Region PinRegion
	Text   string
}

const pinColumns = `id, doc_id, n, page_id, node_id, region, text, author, status, claimed_by, reply, resolved_by, created_at, updated_at, rev`

func scanPin(row interface{ Scan(...any) error }) (Pin, error) {
	var p Pin
	var region string
	if err := row.Scan(&p.ID, &p.WorkspaceID, &p.N, &p.PageID, &p.NodeID, &region, &p.Text, &p.Author, &p.Status,
		&p.ClaimedBy, &p.Reply, &p.ResolvedBy, &p.CreatedAt, &p.UpdatedAt, &p.Rev); err != nil {
		return Pin{}, err
	}
	_ = json.Unmarshal([]byte(region), &p.Region)
	return p, nil
}

// resolveWorkspace turns "" into the active workspace and checks that an explicit id exists.
func (s *Store) resolveWorkspace(id string) (string, error) {
	if id == "" {
		return s.DocID(), nil
	}
	if _, err := s.workspaceInfo(id); err != nil {
		return "", err
	}
	return id, nil
}

// decorate adds the target node's current name (or that it is gone) from the workspace's document.
func (s *Store) decoratePins(docID string, pins []Pin) {
	var doc *core.Document
	if head, err := s.ReadWorkspace(docID); err == nil {
		doc = head.Doc
	}
	for i := range pins {
		if pins[i].NodeID == "" || doc == nil {
			continue
		}
		if n := core.GetNode(doc, pins[i].NodeID); n != nil {
			pins[i].NodeName = n.Str("name")
		} else {
			pins[i].NodeMissing = true
		}
	}
}

func cleanText(s string) string { return strings.TrimSpace(s) }

// CreatePin stores a new open pin in a workspace ("" = the active one).
func (s *Store) CreatePin(workspaceID string, in NewPin, author string) (Pin, error) {
	docID, err := s.resolveWorkspace(workspaceID)
	if err != nil {
		return Pin{}, err
	}
	text := cleanText(in.Text)
	if text == "" {
		return Pin{}, fmt.Errorf("%w: text cannot be blank", ErrPinInput)
	}
	if len([]rune(text)) > MaxPinText {
		return Pin{}, fmt.Errorf("%w: text is longer than %d characters", ErrPinInput, MaxPinText)
	}
	if in.Region.Width < 0 || in.Region.Height < 0 {
		return Pin{}, fmt.Errorf("%w: region width and height cannot be negative", ErrPinInput)
	}
	region, _ := json.Marshal(in.Region)
	now := time.Now().UnixMilli()
	id := core.NewID()
	_, err = s.db.Exec(`INSERT INTO pins(`+pinColumns+`) VALUES(?, ?,
		(SELECT COALESCE(MAX(n), 0) + 1 FROM pins WHERE doc_id = ?), ?, ?, ?, ?, ?, 'open', '', '', '', ?, ?,
		(SELECT COALESCE(MAX(rev), 0) + 1 FROM pins))`,
		id, docID, docID, in.PageID, in.NodeID, string(region), text, author, now, now)
	if err != nil {
		return Pin{}, err
	}
	return s.GetPin(id)
}

// GetPin reads one pin (deleted ones too).
func (s *Store) GetPin(id string) (Pin, error) {
	p, err := scanPin(s.db.QueryRow(`SELECT `+pinColumns+` FROM pins WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Pin{}, ErrNoPin
	}
	if err != nil {
		return Pin{}, err
	}
	pins := []Pin{p}
	s.decoratePins(p.WorkspaceID, pins)
	return pins[0], nil
}

// PinFilter narrows ListPins. Status: open (default: open and claimed), claimed, resolved or all
// (everything but deleted).
type PinFilter struct {
	WorkspaceID string
	Status      string
	PageID      string
	AfterRev    int64
}

// ListPins reads the pins of a workspace, oldest first.
func (s *Store) ListPins(f PinFilter) ([]Pin, error) {
	docID, err := s.resolveWorkspace(f.WorkspaceID)
	if err != nil {
		return nil, err
	}
	query := `SELECT ` + pinColumns + ` FROM pins WHERE doc_id = ?`
	args := []any{docID}
	switch f.Status {
	case "", PinOpen:
		query += ` AND status IN ('open', 'claimed')`
	case PinClaimed, PinResolved:
		query += ` AND status = ?`
		args = append(args, f.Status)
	case "all":
		query += ` AND status != 'deleted'`
	default:
		return nil, fmt.Errorf("%w: status must be open, claimed, resolved or all", ErrPinInput)
	}
	if f.PageID != "" {
		query += ` AND page_id = ?`
		args = append(args, f.PageID)
	}
	if f.AfterRev > 0 {
		query += ` AND rev > ?`
		args = append(args, f.AfterRev)
	}
	query += ` ORDER BY n`
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Pin{}
	for rows.Next() {
		p, err := scanPin(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	s.decoratePins(docID, out)
	return out, nil
}

// CountOpenPins counts the open (not yet claimed) pins of a workspace ("" = active). Errors count as 0:
// it only feeds a hint in tool results.
func (s *Store) CountOpenPins(workspaceID string) int {
	docID, err := s.resolveWorkspace(workspaceID)
	if err != nil {
		return 0
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM pins WHERE doc_id = ? AND status = 'open'`, docID).Scan(&n); err != nil {
		return 0
	}
	return n
}

// PinsRev is the latest change counter over every pin.
func (s *Store) PinsRev() int64 {
	var rev int64
	_ = s.db.QueryRow(`SELECT COALESCE(MAX(rev), 0) FROM pins`).Scan(&rev)
	return rev
}

// updatePin applies a status change inside one statement guarded by the expected states.
func (s *Store) updatePin(id string, set string, args []any, allowed ...string) (Pin, error) {
	cur, err := s.GetPin(id)
	if err != nil {
		return Pin{}, err
	}
	if cur.Status == PinDeleted {
		return Pin{}, ErrNoPin
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(allowed)), ",")
	q := `UPDATE pins SET ` + set + `, updated_at = ?, rev = (SELECT COALESCE(MAX(rev), 0) + 1 FROM pins)
		WHERE id = ? AND status IN (` + placeholders + `)`
	all := append(append(args, time.Now().UnixMilli(), id), anySlice(allowed)...)
	res, err := s.db.Exec(q, all...)
	if err != nil {
		return Pin{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Pin{}, errors.New("pin changed meanwhile: read it again")
	}
	return s.GetPin(id)
}

func anySlice(ss []string) []any {
	out := make([]any, len(ss))
	for i, s := range ss {
		out[i] = s
	}
	return out
}

// ClaimPin marks a pin as taken by an agent. Claiming one's own claim again is a no-op.
func (s *Store) ClaimPin(id, actor string) (Pin, error) {
	cur, err := s.GetPin(id)
	if err != nil {
		return Pin{}, err
	}
	switch cur.Status {
	case PinDeleted:
		return Pin{}, ErrNoPin
	case PinResolved:
		return Pin{}, ErrPinResolved
	case PinClaimed:
		if cur.ClaimedBy == actor {
			return cur, nil
		}
		return Pin{}, fmt.Errorf("%w (%s)", ErrPinClaimed, cur.ClaimedBy)
	}
	return s.updatePin(id, `status = 'claimed', claimed_by = ?`, []any{actor}, PinOpen)
}

// ResolvePin closes a pin with a short reply. Another agent's claim blocks it.
func (s *Store) ResolvePin(id, actor, reply string) (Pin, error) {
	reply = cleanText(reply)
	if reply == "" {
		return Pin{}, fmt.Errorf("%w: reply cannot be blank: say what was done", ErrPinInput)
	}
	if len([]rune(reply)) > MaxPinReply {
		return Pin{}, fmt.Errorf("%w: reply is longer than %d characters", ErrPinInput, MaxPinReply)
	}
	cur, err := s.GetPin(id)
	if err != nil {
		return Pin{}, err
	}
	switch {
	case cur.Status == PinDeleted:
		return Pin{}, ErrNoPin
	case cur.Status == PinResolved:
		return Pin{}, ErrPinResolved
	case cur.Status == PinClaimed && cur.ClaimedBy != actor && strings.HasPrefix(actor, "agent:"):
		return Pin{}, fmt.Errorf("%w (%s)", ErrPinClaimed, cur.ClaimedBy)
	}
	return s.updatePin(id, `status = 'resolved', reply = ?, resolved_by = ?, claimed_by = CASE WHEN claimed_by = '' THEN ? ELSE claimed_by END`,
		[]any{reply, actor, actor}, PinOpen, PinClaimed)
}

// ReopenPin puts a claimed or resolved pin back to open (the human's call; it keeps the last reply).
func (s *Store) ReopenPin(id string) (Pin, error) {
	return s.updatePin(id, `status = 'open', claimed_by = ''`, nil, PinClaimed, PinResolved)
}

// EditPin changes the text of a pin that no agent resolved yet.
func (s *Store) EditPin(id, text string) (Pin, error) {
	text = cleanText(text)
	if text == "" {
		return Pin{}, fmt.Errorf("%w: text cannot be blank", ErrPinInput)
	}
	if len([]rune(text)) > MaxPinText {
		return Pin{}, fmt.Errorf("%w: text is longer than %d characters", ErrPinInput, MaxPinText)
	}
	return s.updatePin(id, `text = ?`, []any{text}, PinOpen, PinClaimed)
}

// DeletePin hides a pin (soft delete, so watchers see the change).
func (s *Store) DeletePin(id string) (Pin, error) {
	return s.updatePin(id, `status = 'deleted'`, nil, PinOpen, PinClaimed, PinResolved)
}

// pinsWaitPoll is how often wait_for_pins and the WebSocket broadcast read the pins table: another process
// (`paprika mcp` over stdio) may write it.
const pinsWaitPoll = 150 * time.Millisecond

// WaitForPins blocks until a workspace has open pins changed after `since` (rev), or the timeout. It
// returns the open pins changed after since and the latest rev to pass next time.
func (s *Store) WaitForPins(ctx context.Context, workspaceID string, since int64, timeout time.Duration) ([]Pin, int64, error) {
	deadline := time.Now().Add(timeout)
	for {
		pins, err := s.ListPins(PinFilter{WorkspaceID: workspaceID, Status: PinOpen, AfterRev: since})
		if err != nil {
			return nil, since, err
		}
		fresh := pins[:0]
		for _, p := range pins {
			if p.Status == PinOpen {
				fresh = append(fresh, p)
			}
		}
		rev := s.PinsRev()
		if len(fresh) > 0 || time.Now().After(deadline) {
			return fresh, rev, nil
		}
		select {
		case <-ctx.Done():
			return []Pin{}, rev, nil
		case <-time.After(pinsWaitPoll):
		}
	}
}
