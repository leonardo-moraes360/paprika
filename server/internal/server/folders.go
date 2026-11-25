package server

import (
	"errors"
	"strings"
	"time"

	"github.com/leonardo-moraes360/paprika/server/internal/core"
)

// Folder is one overview folder. Workspaces point at it with folderId; an empty id is the root.
type Folder struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	UpdatedAt int64  `json:"updatedAt"`
}

// ErrNoFolder is returned when a folder id is not in this database.
var ErrNoFolder = errors.New("folder not found")

// ErrBlankName is returned when a folder name is empty after trimming.
var ErrBlankName = errors.New("name must not be blank")

// ListFolders returns the overview folders, most recently updated first.
func (s *Store) ListFolders() ([]Folder, error) {
	rows, err := s.db.Query(`SELECT id, name, updated_at FROM folders ORDER BY updated_at DESC, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Folder{}
	for rows.Next() {
		var f Folder
		if err := rows.Scan(&f.ID, &f.Name, &f.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// CreateFolder adds an overview folder. It does not contain a workspace until move.
func (s *Store) CreateFolder(name string) (Folder, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Folder{}, ErrBlankName
	}
	if len([]rune(name)) > 120 {
		return Folder{}, errors.New("name must be at most 120 characters")
	}
	f := Folder{ID: core.NewID(), Name: name, UpdatedAt: time.Now().UnixMilli()}
	_, err := s.db.Exec(`INSERT INTO folders(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`, f.ID, f.Name, f.UpdatedAt, f.UpdatedAt)
	if err != nil {
		return Folder{}, err
	}
	return f, nil
}

// RenameFolder changes a folder's name.
func (s *Store) RenameFolder(id, name string) (Folder, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Folder{}, ErrBlankName
	}
	if len([]rune(name)) > 120 {
		return Folder{}, errors.New("name must be at most 120 characters")
	}
	now := time.Now().UnixMilli()
	res, err := s.db.Exec(`UPDATE folders SET name = ?, updated_at = ? WHERE id = ?`, name, now, id)
	if err != nil {
		return Folder{}, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return Folder{}, ErrNoFolder
	}
	return Folder{ID: id, Name: name, UpdatedAt: now}, nil
}

// MoveWorkspace puts a workspace in a folder. An empty folderID moves it back to the root.
func (s *Store) MoveWorkspace(id, folderID, actor string) (WorkspaceInfo, error) {
	folderID = strings.TrimSpace(folderID)
	if folderID != "" {
		var n int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM folders WHERE id = ?`, folderID).Scan(&n); err != nil {
			return WorkspaceInfo{}, err
		}
		if n == 0 {
			return WorkspaceInfo{}, ErrNoFolder
		}
	}
	info, err := s.workspaceInfo(id)
	if err != nil {
		return WorkspaceInfo{}, err
	}
	if _, err := s.db.Exec(`UPDATE documents SET folder_id = ? WHERE id = ?`, folderID, id); err != nil {
		return WorkspaceInfo{}, err
	}
	s.logWorkspaceOp(actor, "move", id, info.Name, map[string]any{"folderId": folderID})
	return s.workspaceInfo(id)
}
