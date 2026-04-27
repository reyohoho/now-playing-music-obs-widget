package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

//go:embed static
var staticFS embed.FS

const (
	// publishMaxBytes caps the JSON body size for publish requests.
	publishMaxBytes = 16 * 1024
	// roomIdleTTL governs how long an unused room hangs around in memory.
	roomIdleTTL = 30 * time.Minute
	// roomGCInterval is how often we prune idle rooms.
	roomGCInterval = 5 * time.Minute
	// wsWriteWait is the deadline for a single websocket write.
	wsWriteWait = 10 * time.Second
	// wsPongWait is how long we wait for a client pong before dropping it.
	wsPongWait = 60 * time.Second
	// wsPingPeriod must be smaller than wsPongWait.
	wsPingPeriod = 25 * time.Second
)

// idPattern validates room IDs. We only accept UUID-like tokens (with dashes)
// or plain alphanumeric tokens to avoid path escapes and keep URLs tidy.
var idPattern = regexp.MustCompile(`^[A-Za-z0-9-]{8,128}$`)

// ---------------------------------------------------------------------------
// auth store
// ---------------------------------------------------------------------------

// authStore persists the hash of each room's secret key to disk so that a
// publisher survives server restarts without losing write access.
type authStore struct {
	mu   sync.RWMutex
	path string
	Keys map[string]string `json:"keys"`
}

func newAuthStore(path string) (*authStore, error) {
	s := &authStore{path: path, Keys: map[string]string{}}
	if path == "" {
		return s, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return s, nil
	}
	if err := json.Unmarshal(data, s); err != nil {
		return nil, err
	}
	if s.Keys == nil {
		s.Keys = map[string]string{}
	}
	return s, nil
}

func (s *authStore) save() error {
	if s.path == "" {
		return nil
	}
	s.mu.RLock()
	data, err := json.MarshalIndent(s, "", "  ")
	s.mu.RUnlock()
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func hashKey(key string) string {
	sum := sha256.Sum256([]byte(key))
	return hex.EncodeToString(sum[:])
}

// authorize validates the supplied key against the stored hash. If the ID has
// never been seen before, the key is registered (trust on first use).
func (s *authStore) authorize(id, key string) bool {
	if id == "" || key == "" {
		return false
	}
	incoming := hashKey(key)

	s.mu.Lock()
	stored, ok := s.Keys[id]
	if !ok {
		s.Keys[id] = incoming
		s.mu.Unlock()
		if err := s.save(); err != nil {
			log.Printf("auth store save failed: %v", err)
		}
		return true
	}
	s.mu.Unlock()

	return subtle.ConstantTimeCompare([]byte(stored), []byte(incoming)) == 1
}

// ---------------------------------------------------------------------------
// hub / rooms
// ---------------------------------------------------------------------------

type subClient struct {
	hub  *hub
	room *room
	conn *websocket.Conn
	send chan []byte
}

type songPayload struct {
	Type       string `json:"type"`
	Text       string `json:"text"`
	ProviderID string `json:"providerId,omitempty"`
	UpdatedAt  int64  `json:"updatedAt,omitempty"`
}

// overlaySettings mirrors the subset of options exposed to the viewer in the
// extension's "Внешний вид оверлея" panel. We accept any JSON object here so
// that newer clients can add fields without requiring a backend redeploy —
// validation of individual values happens in the overlay page itself.
type overlaySettings = map[string]any

type settingsPayload struct {
	Type     string          `json:"type"`
	Settings overlaySettings `json:"settings"`
}

type room struct {
	id           string
	mu           sync.RWMutex
	subs         map[*subClient]struct{}
	lastText     string
	lastProv     string
	lastUpdate   time.Time
	lastSettings overlaySettings
	touched      time.Time
}

func newRoom(id string) *room {
	now := time.Now()
	return &room{
		id:      id,
		subs:    map[*subClient]struct{}{},
		touched: now,
	}
}

func (r *room) snapshot() songPayload {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return songPayload{
		Type:       "song",
		Text:       r.lastText,
		ProviderID: r.lastProv,
		UpdatedAt:  r.lastUpdate.UnixMilli(),
	}
}

func (r *room) subCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.subs)
}

func (r *room) touch() {
	r.mu.Lock()
	r.touched = time.Now()
	r.mu.Unlock()
}

func (r *room) broadcast(payload []byte) {
	r.mu.RLock()
	targets := make([]*subClient, 0, len(r.subs))
	for c := range r.subs {
		targets = append(targets, c)
	}
	r.mu.RUnlock()

	for _, c := range targets {
		select {
		case c.send <- payload:
		default:
			go c.shutdown()
		}
	}
}

func (r *room) publish(text, providerID string) ([]byte, error) {
	payload := songPayload{
		Type:       "song",
		Text:       text,
		ProviderID: providerID,
		UpdatedAt:  time.Now().UnixMilli(),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	r.lastText = text
	r.lastProv = providerID
	r.lastUpdate = time.Now()
	r.touched = time.Now()
	r.mu.Unlock()

	r.broadcast(data)
	return data, nil
}

// updateSettings caches the latest overlay appearance config and broadcasts
// it to every connected overlay. A nil or empty settings map clears the
// cache instead so that a fresh subscriber won't receive stale values.
func (r *room) updateSettings(settings overlaySettings) ([]byte, error) {
	payload := settingsPayload{Type: "settings", Settings: settings}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	r.mu.Lock()
	if settings == nil {
		r.lastSettings = nil
	} else {
		copyMap := make(overlaySettings, len(settings))
		for k, v := range settings {
			copyMap[k] = v
		}
		r.lastSettings = copyMap
	}
	r.touched = time.Now()
	r.mu.Unlock()

	r.broadcast(data)
	return data, nil
}

type hub struct {
	mu    sync.RWMutex
	rooms map[string]*room
}

func newHub() *hub {
	return &hub{rooms: map[string]*room{}}
}

func (h *hub) get(id string) *room {
	h.mu.RLock()
	r := h.rooms[id]
	h.mu.RUnlock()
	return r
}

func (h *hub) getOrCreate(id string) *room {
	if r := h.get(id); r != nil {
		r.touch()
		return r
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if r, ok := h.rooms[id]; ok {
		r.touch()
		return r
	}
	r := newRoom(id)
	h.rooms[id] = r
	return r
}

// gc removes rooms with no subscribers and no activity for roomIdleTTL.
func (h *hub) gc() {
	cutoff := time.Now().Add(-roomIdleTTL)
	h.mu.Lock()
	for id, r := range h.rooms {
		r.mu.RLock()
		idle := len(r.subs) == 0 && r.touched.Before(cutoff)
		r.mu.RUnlock()
		if idle {
			delete(h.rooms, id)
		}
	}
	h.mu.Unlock()
}

// ---------------------------------------------------------------------------
// sub client lifecycle
// ---------------------------------------------------------------------------

func (c *subClient) shutdown() {
	c.room.mu.Lock()
	if _, ok := c.room.subs[c]; ok {
		delete(c.room.subs, c)
		close(c.send)
	}
	c.room.mu.Unlock()
	_ = c.conn.Close()
}

func (c *subClient) writer() {
	ticker := time.NewTicker(wsPingPeriod)
	defer ticker.Stop()

	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *subClient) reader() {
	defer c.shutdown()
	c.conn.SetReadLimit(512)
	_ = c.conn.SetReadDeadline(time.Now().Add(wsPongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(wsPongWait))
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

// ---------------------------------------------------------------------------
// overlay HTML template
// ---------------------------------------------------------------------------

// overlayHandler serves the overlay HTML with the room ID injected. The
// appearance (background, fonts, colors, provider icon) is no longer selected
// via a query param — instead the extension pushes live `settings` updates
// through the publish endpoint, which are forwarded to every connected
// overlay via WebSocket. The ?theme= parameter, if present, is ignored.
func overlayHandler(overlayTpl []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !idPattern.MatchString(id) {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}
		html := strings.ReplaceAll(string(overlayTpl), "__ROOM_ID__", jsString(id))
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte(html))
	}
}

// jsString produces a safe JS string literal contents for interpolation.
// Since the ID is already validated by idPattern it cannot contain unsafe
// characters, but we escape defensively anyway.
func jsString(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '\\':
			b.WriteString("\\\\")
		case '"':
			b.WriteString("\\\"")
		case '<':
			b.WriteString("\\u003c")
		case '>':
			b.WriteString("\\u003e")
		case '&':
			b.WriteString("\\u0026")
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

type server struct {
	hub      *hub
	auth     *authStore
	upgrader websocket.Upgrader
	overlay  []byte
}

func newServer(auth *authStore, overlay []byte) *server {
	return &server{
		hub:  newHub(),
		auth: auth,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		overlay: overlay,
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// applyCORS sets permissive CORS headers for the API endpoints consumed by
// the extension. The extension runs from chrome-extension://<id> so we cannot
// enumerate a fixed origin; allow all and protect writes via Bearer key.
func applyCORS(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.Header().Set("Access-Control-Max-Age", "600")
}

func (s *server) handleStatus(w http.ResponseWriter, r *http.Request) {
	applyCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if !idPattern.MatchString(id) {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	room := s.hub.get(id)
	var count int
	if room != nil {
		count = room.subCount()
		room.touch()
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id":          id,
		"subscribers": count,
	})
}

func extractBearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return ""
	}
	return strings.TrimSpace(h[len("bearer "):])
}

type publishRequest struct {
	Text       string          `json:"text"`
	ProviderID string          `json:"providerId"`
	Settings   overlaySettings `json:"settings,omitempty"`
	// SettingsOnly lets the extension push only appearance updates without
	// touching the cached track. Useful when the user tweaks fonts/colors
	// between track changes.
	SettingsOnly bool `json:"settingsOnly,omitempty"`
}

func (s *server) handlePublish(w http.ResponseWriter, r *http.Request) {
	applyCORS(w, r)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.PathValue("id")
	if !idPattern.MatchString(id) {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	key := extractBearer(r)
	if !s.auth.authorize(id, key) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, publishMaxBytes)
	var body publishRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body: "+err.Error(), http.StatusBadRequest)
		return
	}

	room := s.hub.getOrCreate(id)

	if body.Settings != nil {
		if _, err := room.updateSettings(body.Settings); err != nil {
			http.Error(w, "settings publish failed", http.StatusInternalServerError)
			return
		}
	}

	if !body.SettingsOnly {
		text := strings.TrimSpace(body.Text)
		if _, err := room.publish(text, body.ProviderID); err != nil {
			http.Error(w, "publish failed", http.StatusInternalServerError)
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"subscribers": room.subCount(),
	})
}

func (s *server) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !idPattern.MatchString(id) {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade failed for id=%s: %v", id, err)
		return
	}

	room := s.hub.getOrCreate(id)
	client := &subClient{
		hub:  s.hub,
		room: room,
		conn: conn,
		send: make(chan []byte, 8),
	}

	room.mu.Lock()
	room.subs[client] = struct{}{}
	snap := songPayload{
		Type:       "song",
		Text:       room.lastText,
		ProviderID: room.lastProv,
		UpdatedAt:  room.lastUpdate.UnixMilli(),
	}
	var cachedSettings overlaySettings
	if room.lastSettings != nil {
		cachedSettings = make(overlaySettings, len(room.lastSettings))
		for k, v := range room.lastSettings {
			cachedSettings[k] = v
		}
	}
	room.mu.Unlock()

	// Send cached state so a freshly reconnected overlay doesn't have to wait
	// for the next track change or settings edit. Settings go first so they
	// are applied before the track renders.
	if cachedSettings != nil {
		if data, err := json.Marshal(settingsPayload{Type: "settings", Settings: cachedSettings}); err == nil {
			client.send <- data
		}
	}
	if snap.Text != "" {
		if data, err := json.Marshal(snap); err == nil {
			client.send <- data
		}
	}

	go client.writer()
	go client.reader()
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "uptime": time.Since(startedAt).String()})
}

var startedAt = time.Now()

// ---------------------------------------------------------------------------
// bootstrap
// ---------------------------------------------------------------------------

func main() {
	addr := envOr("ADDR", ":8787")
	dataDir := envOr("DATA_DIR", "/data")
	authPath := filepath.Join(dataDir, "auth.json")

	auth, err := newAuthStore(authPath)
	if err != nil {
		log.Fatalf("auth store: %v", err)
	}

	staticSub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("static fs: %v", err)
	}
	overlayTpl, err := fs.ReadFile(staticSub, "overlay.html")
	if err != nil {
		log.Fatalf("read overlay.html: %v", err)
	}

	srv := newServer(auth, overlayTpl)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", srv.handleHealth)
	mux.HandleFunc("GET /api/status/{id}", srv.handleStatus)
	mux.HandleFunc("OPTIONS /api/status/{id}", srv.handleStatus)
	mux.HandleFunc("POST /api/publish/{id}", srv.handlePublish)
	mux.HandleFunc("OPTIONS /api/publish/{id}", srv.handlePublish)
	mux.HandleFunc("GET /ws/sub/{id}", srv.handleSubscribe)
	mux.HandleFunc("GET /overlay/{id}", overlayHandler(overlayTpl))
	// Friendly index that simply notes what this host is.
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ya-music-obs-widget backend\nSee /overlay/<id> and POST /api/publish/<id>.\n"))
	})

	httpSrv := &http.Server{
		Addr:              addr,
		Handler:           logMiddleware(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		ticker := time.NewTicker(roomGCInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				srv.hub.gc()
			}
		}
	}()

	go func() {
		log.Printf("listening on %s", addr)
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http server: %v", err)
		}
	}()

	<-ctx.Done()
	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	log.Println("shutting down")
	_ = httpSrv.Shutdown(shutCtx)
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func logMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rw.status, time.Since(start))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// Hijack exposes the underlying connection so that handlers like the
// websocket upgrader (which require http.Hijacker) keep working through the
// logging middleware. Without this, Upgrade() returns HTTP 500 with
// "response does not implement http.Hijacker".
func (s *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := s.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("underlying ResponseWriter does not support hijacking")
	}
	return h.Hijack()
}

// Flush passes Flush() through so that SSE/chunked handlers keep working
// behind the logging middleware.
func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
