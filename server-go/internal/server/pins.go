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
// exported and not in the design's undo history. Team sync carries pins beside the document, in the same
// Loro workspace (a map of pins and a map of replies), not as doc.nodes. Agents read pins over MCP
// (list_pins, claim_pin, reply_pin, resolve_pin, wait_for_pins); the canvas over /api/pins and a
// {type:"pins"} WebSocket message.

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
CREATE TABLE IF NOT EXISTS pin_replies (
  id         TEXT PRIMARY KEY,
  pin_id     TEXT NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pin_replies_pin ON pin_replies(pin_id, created_at);
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

// PinReply is one message on a pin's thread (human or agent).
type PinReply struct {
	ID        string `json:"id"`
	Author    string `json:"author"`
	Text      string `json:"text"`
	CreatedAt int64  `json:"createdAt"`
}

// PinRegion is a box in canvas coordinates.
type PinRegion struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// Pin is one request from a human to the agents, anchored to a node or an area.
type Pin struct {
	ID          string     `json:"id"`
	N           int        `json:"n"`
	WorkspaceID string     `json:"workspaceId"`
	PageID      string     `json:"pageId,omitempty"`
	NodeID      string     `json:"nodeId,omitempty"`
	NodeName    string     `json:"nodeName,omitempty"`
	NodeMissing bool       `json:"nodeMissing,omitempty"`
	Region      PinRegion  `json:"region"`
	Text        string     `json:"text"`
	Author      string     `json:"author"`
	Status      string     `json:"status"`
	ClaimedBy   string     `json:"claimedBy,omitempty"`
	Reply       string     `json:"reply,omitempty"`
	Replies     []PinReply `json:"replies,omitempty"`
	ResolvedBy  string     `json:"resolvedBy,omitempty"`
	CreatedAt   int64      `json:"createdAt"`
	UpdatedAt   int64      `json:"updatedAt"`
	Rev         int64      `json:"rev"`
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
	_, err = s.db.Exec(`INSERT INTO pins(id, doc_id, n, page_id, node_id, region, text, author, status, claimed_by, reply, resolved_by, created_at, updated_at, rev) VALUES(?, ?,
		(SELECT COALESCE(MAX(n), 0) + 1 FROM pins WHERE doc_id = ?), ?, ?, ?, ?, ?, 'open', '', '', '', ?, ?,
		(SELECT COALESCE(MAX(rev), 0) + 1 FROM pins))`,
		id, docID, docID, in.PageID, in.NodeID, string(region), text, author, now, now)
	if err != nil {
		return Pin{}, err
	}
	p, err := s.GetPin(id)
	if err == nil {
		s.notifyPins(docID)
	}
	return p, err
}

// GetPin reads one pin (deleted ones too).
func (s *Store) GetPin(id string) (Pin, error) {
	p, err := scanPin(s.db.QueryRow(`SELECT id, doc_id, n, page_id, node_id, region, text, author, status, claimed_by, reply, resolved_by, created_at, updated_at, rev FROM pins WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return Pin{}, ErrNoPin
	}
	if err != nil {
		return Pin{}, err
	}
	pins := []Pin{p}
	s.decoratePins(p.WorkspaceID, pins)
	s.attachReplies(pins)
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

const listPinsSQL = `SELECT id, doc_id, n, page_id, node_id, region, text, author, status, claimed_by, reply, resolved_by, created_at, updated_at, rev FROM pins
	WHERE doc_id = ? AND status IN (?, ?, ?) AND (? = '' OR page_id = ?) AND rev > ?
	ORDER BY n`

// ListPins reads the pins of a workspace, oldest first.
func (s *Store) ListPins(f PinFilter) ([]Pin, error) {
	docID, err := s.resolveWorkspace(f.WorkspaceID)
	if err != nil {
		return nil, err
	}
	// One fixed statement: the filters are bound values, never spliced SQL.
	var statuses [3]string
	switch f.Status {
	case "", PinOpen:
		statuses = [3]string{PinOpen, PinClaimed, PinClaimed}
	case PinClaimed, PinResolved:
		statuses = [3]string{f.Status, f.Status, f.Status}
	case "all":
		statuses = [3]string{PinOpen, PinClaimed, PinResolved}
	default:
		return nil, fmt.Errorf("%w: status must be open, claimed, resolved or all", ErrPinInput)
	}
	args := []any{docID, statuses[0], statuses[1], statuses[2], f.PageID, f.PageID, f.AfterRev}
	rows, err := s.db.Query(listPinsSQL, args...)
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
	s.attachReplies(out)
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

// Every pin write is one fixed statement guarded by the states it may start from, so a concurrent change
// makes it affect no row instead of overwriting.
const (
	claimPinSQL   = `UPDATE pins SET status = 'claimed', claimed_by = ?, updated_at = ?, rev = (SELECT COALESCE(MAX(rev), 0) + 1 FROM pins) WHERE id = ? AND status = 'open'`
	resolvePinSQL = `UPDATE pins SET status = 'resolved', reply = ?, resolved_by = ?,
		claimed_by = CASE WHEN claimed_by = '' THEN ? ELSE claimed_by END, updated_at = ?, rev = (SELECT COALESCE(MAX(rev), 0) + 1 FROM pins)
		WHERE id = ? AND status IN ('open', 'claimed')`
	reopenPinSQL = `UPDATE pins SET status = 'open', claimed_by = '', updated_at = ?, rev = (SELECT COALESCE(MAX(rev), 0) + 1 FROM pins) WHERE id = ? AND status IN ('claimed', 'resolved')`
	replyPinSQL  = `UPDATE pins SET reply = ?, updated_at = ?, rev = (SELECT COALESCE(MAX(rev), 0) + 1 FROM pins) WHERE id = ? AND status != 'deleted'`
	editPinSQL   = `UPDATE pins SET text = ?, updated_at = ?, rev = (SELECT COALESCE(MAX(rev), 0) + 1 FROM pins) WHERE id = ? AND status IN ('open', 'claimed')`
	deletePinSQL = `UPDATE pins SET status = 'deleted', updated_at = ?, rev = (SELECT COALESCE(MAX(rev), 0) + 1 FROM pins) WHERE id = ? AND status IN ('open', 'claimed', 'resolved')`
)

// updatePin runs one of the fixed pin writes above; args are the SET values, then updated_at and id follow.
func (s *Store) updatePin(id string, stmt string, args ...any) (Pin, error) {
	cur, err := s.GetPin(id)
	if err != nil {
		return Pin{}, err
	}
	if cur.Status == PinDeleted {
		return Pin{}, ErrNoPin
	}
	res, err := s.db.Exec(stmt, append(args, time.Now().UnixMilli(), id)...)
	if err != nil {
		return Pin{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Pin{}, errors.New("pin changed meanwhile: read it again")
	}
	p, err := s.GetPin(id)
	if err == nil {
		s.notifyPins(p.WorkspaceID)
	}
	return p, err
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
	return s.updatePin(id, claimPinSQL, actor)
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
	row, err := s.insertReply(id, actor, reply, time.Now().UnixMilli())
	if err != nil {
		return Pin{}, err
	}
	p, err := s.updatePin(id, resolvePinSQL, reply, actor, actor)
	if err != nil {
		_, _ = s.db.Exec(`DELETE FROM pin_replies WHERE id = ?`, row.ID)
		return Pin{}, err
	}
	return p, nil
}

// ReplyPin appends a message to a pin's thread. It does not change the pin's status.
func (s *Store) ReplyPin(id, actor, text string) (Pin, error) {
	text = cleanText(text)
	if text == "" {
		return Pin{}, fmt.Errorf("%w: reply cannot be blank", ErrPinInput)
	}
	if len([]rune(text)) > MaxPinReply {
		return Pin{}, fmt.Errorf("%w: reply is longer than %d characters", ErrPinInput, MaxPinReply)
	}
	cur, err := s.GetPin(id)
	if err != nil {
		return Pin{}, err
	}
	if cur.Status == PinDeleted {
		return Pin{}, ErrNoPin
	}
	if _, err := s.insertReply(id, actor, text, time.Now().UnixMilli()); err != nil {
		return Pin{}, err
	}
	return s.updatePin(id, replyPinSQL, text)
}

// ReopenPin puts a claimed or resolved pin back to open (the human's call; it keeps the last reply).
func (s *Store) ReopenPin(id string) (Pin, error) {
	return s.updatePin(id, reopenPinSQL)
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
	return s.updatePin(id, editPinSQL, text)
}

// DeletePin hides a pin (soft delete, so watchers see the change).
func (s *Store) DeletePin(id string) (Pin, error) {
	return s.updatePin(id, deletePinSQL)
}

func (s *Store) insertReply(pinID, author, text string, at int64) (PinReply, error) {
	row := PinReply{ID: core.NewID(), Author: author, Text: text, CreatedAt: at}
	_, err := s.db.Exec(`INSERT INTO pin_replies(id, pin_id, author, text, created_at) VALUES(?, ?, ?, ?, ?)`,
		row.ID, pinID, row.Author, row.Text, row.CreatedAt)
	if err != nil {
		return PinReply{}, err
	}
	return row, nil
}

func (s *Store) attachReplies(pins []Pin) {
	if len(pins) == 0 {
		return
	}
	by := map[string][]PinReply{}
	for _, p := range pins {
		rows, err := s.db.Query(`SELECT id, author, text, created_at FROM pin_replies WHERE pin_id = ? ORDER BY created_at, id`, p.ID)
		if err != nil {
			return
		}
		for rows.Next() {
			var r PinReply
			if err := rows.Scan(&r.ID, &r.Author, &r.Text, &r.CreatedAt); err != nil {
				rows.Close()
				return
			}
			by[p.ID] = append(by[p.ID], r)
		}
		rows.Close()
	}
	for i := range pins {
		rs := by[pins[i].ID]
		if len(rs) == 0 && pins[i].Reply != "" {
			author := pins[i].ResolvedBy
			if author == "" {
				author = "user"
			}
			rs = []PinReply{{ID: "legacy-" + pins[i].ID, Author: author, Text: pins[i].Reply, CreatedAt: pins[i].UpdatedAt}}
		}
		if len(rs) > 0 {
			pins[i].Replies = rs
		}
	}
}

type pinSyncHeader struct {
	N          int       `json:"n"`
	PageID     string    `json:"pageId"`
	NodeID     string    `json:"nodeId"`
	Region     PinRegion `json:"region"`
	Text       string    `json:"text"`
	Author     string    `json:"author"`
	Status     string    `json:"status"`
	ClaimedBy  string    `json:"claimedBy"`
	Reply      string    `json:"reply"`
	ResolvedBy string    `json:"resolvedBy"`
	CreatedAt  int64     `json:"createdAt"`
	UpdatedAt  int64     `json:"updatedAt"`
}

func (p Pin) syncHeader() pinSyncHeader {
	return pinSyncHeader{p.N, p.PageID, p.NodeID, p.Region, p.Text, p.Author, p.Status, p.ClaimedBy, p.Reply, p.ResolvedBy, p.CreatedAt, p.UpdatedAt}
}

// HeaderJSON is the pin record that team sync stores, without derived fields or the thread.
func (p Pin) HeaderJSON() string {
	b, _ := json.Marshal(p.syncHeader())
	return string(b)
}

// SyncJSON is one reply as team sync stores it.
func (r PinReply) SyncJSON(pinID string) string {
	b, _ := json.Marshal(struct {
		PinID     string `json:"pinId"`
		Author    string `json:"author"`
		Text      string `json:"text"`
		CreatedAt int64  `json:"createdAt"`
	}{pinID, r.Author, r.Text, r.CreatedAt})
	return string(b)
}

// ExportPins reads every pin of a workspace, including deleted ones, for team sync.
func (s *Store) ExportPins(docID string) ([]Pin, error) {
	rows, err := s.db.Query(`SELECT id, doc_id, n, page_id, node_id, region, text, author, status, claimed_by, reply, resolved_by, created_at, updated_at, rev FROM pins WHERE doc_id = ? ORDER BY n`, docID)
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
	s.attachReplies(out)
	return out, nil
}

// PinSyncMaps is the pin and reply records of a workspace, keyed by id, for the first share.
func (s *Store) PinSyncMaps(docID string) (pins, replies map[string]json.RawMessage) {
	pins = map[string]json.RawMessage{}
	replies = map[string]json.RawMessage{}
	list, err := s.ExportPins(docID)
	if err != nil {
		return pins, replies
	}
	for _, p := range list {
		pins[p.ID] = json.RawMessage(p.HeaderJSON())
		for _, r := range p.Replies {
			replies[r.ID] = json.RawMessage(r.SyncJSON(p.ID))
		}
	}
	return pins, replies
}

// ApplySyncedPin upserts a pin that arrived from the team. It does not notify local listeners.
func (s *Store) ApplySyncedPin(docID string, p Pin) error {
	if p.ID == "" || docID == "" {
		return fmt.Errorf("%w: missing id", ErrPinInput)
	}
	cur, err := scanPin(s.db.QueryRow(`SELECT id, doc_id, n, page_id, node_id, region, text, author, status, claimed_by, reply, resolved_by, created_at, updated_at, rev FROM pins WHERE id = ?`, p.ID))
	missing := errors.Is(err, sql.ErrNoRows)
	if err != nil && !missing {
		return err
	}
	if !missing && cur.WorkspaceID != docID {
		return nil
	}
	region, _ := json.Marshal(p.Region)
	changed := missing || cur.HeaderJSON() != p.HeaderJSON()
	if missing {
		_, err = s.db.Exec(`INSERT INTO pins(id, doc_id, n, page_id, node_id, region, text, author, status, claimed_by, reply, resolved_by, created_at, updated_at, rev)
			VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(rev), 0) + 1 FROM pins))`,
			p.ID, docID, p.N, p.PageID, p.NodeID, string(region), p.Text, p.Author, p.Status, p.ClaimedBy, p.Reply, p.ResolvedBy, p.CreatedAt, p.UpdatedAt)
		if err != nil {
			return err
		}
	} else if changed {
		_, err = s.db.Exec(`UPDATE pins SET n=?, page_id=?, node_id=?, region=?, text=?, author=?, status=?, claimed_by=?, reply=?, resolved_by=?, created_at=?, updated_at=?, rev=(SELECT COALESCE(MAX(rev), 0) + 1 FROM pins) WHERE id=? AND doc_id=?`,
			p.N, p.PageID, p.NodeID, string(region), p.Text, p.Author, p.Status, p.ClaimedBy, p.Reply, p.ResolvedBy, p.CreatedAt, p.UpdatedAt, p.ID, docID)
		if err != nil {
			return err
		}
	}
	added := false
	for _, r := range p.Replies {
		if r.ID == "" {
			continue
		}
		res, err := s.db.Exec(`INSERT INTO pin_replies(id, pin_id, author, text, created_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
			r.ID, p.ID, r.Author, r.Text, r.CreatedAt)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			added = true
		}
	}
	if !changed && added {
		_, err = s.db.Exec(`UPDATE pins SET rev = (SELECT COALESCE(MAX(rev), 0) + 1 FROM pins) WHERE id = ?`, p.ID)
	}
	return err
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
