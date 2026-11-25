package team

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

const BinaryName = "paprika-sync"

var ErrNoSidecar = errors.New("sidecar not found: build crates/sync (cargo build --release) and put paprika-sync next to paprika, or set PAPRIKA_SYNC")

func FindBinary() (string, error) {
	if p := os.Getenv("PAPRIKA_SYNC"); p != "" {
		if _, err := os.Stat(p); err != nil {
			return "", fmt.Errorf("PAPRIKA_SYNC=%s: %w", p, err)
		}
		return p, nil
	}
	if exe, err := os.Executable(); err == nil {
		p := filepath.Join(filepath.Dir(exe), BinaryName)
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p, nil
		}
	}
	if p, err := exec.LookPath(BinaryName); err == nil {
		return p, nil
	}
	return "", ErrNoSidecar
}

type Event map[string]any

func (e Event) Type() string { s, _ := e["t"].(string); return s }

type reply struct {
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result"`
	Error  string          `json:"error"`
}

type Sidecar struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	wmu     sync.Mutex
	mu      sync.Mutex
	nextID  int
	pending map[int]chan reply
	onEvent func(Event)
	done    chan struct{}
	ID      string
	Addr    json.RawMessage
}

type Options struct {
	Bin     string
	DataDir string
	Name    string
	NoRelay bool
	Bind    string
	App     string
	Format  string
	Stderr  io.Writer
}

func Start(ctx context.Context, opts Options, onEvent func(Event)) (*Sidecar, error) {
	bin := opts.Bin
	if bin == "" {
		var err error
		if bin, err = FindBinary(); err != nil {
			return nil, err
		}
	}
	args := []string{"--data", opts.DataDir, "--name", opts.Name}
	if opts.NoRelay {
		args = append(args, "--no-relay")
	}
	if opts.Bind != "" {
		args = append(args, "--bind", opts.Bind)
	}
	if opts.App != "" {
		args = append(args, "--app", opts.App)
	}
	if opts.Format != "" {
		args = append(args, "--format", opts.Format)
	}
	cmd := exec.Command(bin, args...)
	cmd.Stderr = opts.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("starting %s: %w", bin, err)
	}
	if onEvent == nil {
		onEvent = func(Event) {}
	}
	s := &Sidecar{cmd: cmd, stdin: stdin, pending: map[int]chan reply{}, onEvent: onEvent, done: make(chan struct{})}
	ready := make(chan Event, 1)
	go s.read(stdout, ready)
	go func() { _ = cmd.Wait(); close(s.done) }()
	select {
	case ev := <-ready:
		s.ID, _ = ev["id"].(string)
		s.Addr, _ = json.Marshal(ev["addr"])
		return s, nil
	case <-s.done:
		return nil, fmt.Errorf("%s exited before it was ready", bin)
	case <-ctx.Done():
		s.Close()
		return nil, ctx.Err()
	case <-time.After(30 * time.Second):
		s.Close()
		return nil, fmt.Errorf("%s did not get ready in 30s", bin)
	}
}

func (s *Sidecar) read(r io.Reader, ready chan Event) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 1<<20), 256<<20)
	for sc.Scan() {
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(sc.Bytes(), &raw); err != nil {
			continue
		}
		var t string
		_ = json.Unmarshal(raw["t"], &t)
		if t == "reply" {
			var id int
			_ = json.Unmarshal(raw["id"], &id)
			var rep reply
			_ = json.Unmarshal(sc.Bytes(), &rep)
			s.mu.Lock()
			ch := s.pending[id]
			delete(s.pending, id)
			s.mu.Unlock()
			if ch != nil {
				ch <- rep
			}
			continue
		}
		var ev Event
		if err := json.Unmarshal(sc.Bytes(), &ev); err != nil {
			continue
		}
		if t == "ready" && ready != nil {
			ready <- ev
			ready = nil
			continue
		}
		s.onEvent(ev)
	}
	s.mu.Lock()
	for id, ch := range s.pending {
		ch <- reply{Error: "sidecar exited"}
		delete(s.pending, id)
	}
	s.mu.Unlock()
}

func (s *Sidecar) Call(ctx context.Context, cmd map[string]any) (json.RawMessage, error) {
	s.mu.Lock()
	s.nextID++
	id := s.nextID
	ch := make(chan reply, 1)
	s.pending[id] = ch
	s.mu.Unlock()
	msg := map[string]any{"id": id}
	maps.Copy(msg, cmd)
	line, err := json.Marshal(msg)
	if err != nil {
		return nil, err
	}
	s.wmu.Lock()
	_, err = s.stdin.Write(append(line, '\n'))
	s.wmu.Unlock()
	if err != nil {
		s.mu.Lock()
		delete(s.pending, id)
		s.mu.Unlock()
		return nil, fmt.Errorf("sidecar: %w", err)
	}
	select {
	case rep := <-ch:
		if !rep.OK {
			return nil, errors.New(rep.Error)
		}
		return rep.Result, nil
	case <-ctx.Done():
		s.mu.Lock()
		delete(s.pending, id)
		s.mu.Unlock()
		return nil, ctx.Err()
	}
}

func (s *Sidecar) Done() <-chan struct{} { return s.done }

func (s *Sidecar) Close() {
	_ = s.stdin.Close()
	select {
	case <-s.done:
	case <-time.After(5 * time.Second):
		_ = s.cmd.Process.Kill()
		<-s.done
	}
}
