// Package lanrelay hosts the deliberately small, independent LAN-facing API.
//
// It must never share the desktop admin HTTP handler: the two services have
// different trust boundaries.  This package only exposes endpoints that have
// passed the per-device signature check.
package lanrelay

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	healthPath       = "/lan/v1/health"
	maxClockSkew     = 90 * time.Second
	nonceLifetime    = 3 * time.Minute
	maxRememberNonce = 4096
	// Image uploads are base64-encoded and can exceed 1 MiB after compression.
	// The endpoint remains paired-device authenticated and service-side image
	// validation still caps decoded bytes at 8 MiB.
	maxActionBody     = 12 << 20
	maxRememberOps    = 2048
	operationLifetime = 10 * time.Minute
	imageURLLifetime  = 5 * time.Minute
	// The mobile UI concurrently polls agents, tasks, messages and approvals.
	// 120/min caused normal foreground use to be throttled; 1,200/min still
	// bounds a paired device to 20 authenticated reads per second.
	readRequestsPerMinute = 1200
)

// SecretLookup returns a decrypted secret only for an active paired device.
// Keeping the database concerns outside this package makes it testable and
// prevents LAN handlers from accidentally gaining broad store access.
type SecretLookup func(ctx context.Context, deviceID string) (secret string, active bool, err error)
type ActionExecutor func(ctx context.Context, action string, payload map[string]any) (any, error)

// ReadExecutor serves LAN DTOs assembled from the local Mac state. It is kept
// separate from ActionExecutor so a read can never accidentally enqueue a
// cloud relay command.
type ReadExecutor func(ctx context.Context, resource string, query url.Values) (any, error)

// Image is a short-lived LAN asset response. The listener owns authorization;
// the service only supplies bytes already stored on the local Mac.
type Image struct {
	Data        []byte
	ContentType string
}

type ImageExecutor func(ctx context.Context, imageName string) (Image, error)

// PairExecutor consumes a short-lived QR challenge and returns the new
// device credentials. Unlike regular LAN APIs it is not HMAC-signed because
// the iPhone does not possess a device key until this call succeeds.
// clientKey is the phone's stable per-install identifier; it may be empty for
// older clients that predate it.
type PairExecutor func(ctx context.Context, sessionID, challenge, clientKey string) (deviceID, secret string, err error)

// PairAckExecutor records that the phone opened the QR. It grants nothing and
// exists so the desktop can replace the QR with a "已扫描" state.
type PairAckExecutor func(ctx context.Context, sessionID, challenge string) error
type AuditEvent struct {
	DeviceID, SourceIP, Operation, Outcome, Detail string
	Status                                         int
}
type AuditSink func(ctx context.Context, event AuditEvent)

type Status struct {
	Running bool   `json:"running"`
	Port    int    `json:"port"`
	Bonjour bool   `json:"bonjour"`
	Error   string `json:"error,omitempty"`
}

type usedNonce struct{ expiresAt time.Time }
type rateWindow struct {
	startedAt time.Time
	count     int
}

type idempotentOperation struct {
	fingerprint string
	done        chan struct{}
	expiresAt   time.Time
	status      int
	body        []byte
}

// Server owns the separate LAN listener. It accepts only private source IPs
// and signed requests; pairing and desktop administration remain on localhost.
type Server struct {
	mu      sync.Mutex
	server  *http.Server
	bonjour *exec.Cmd
	status  Status
	lookup  SecretLookup
	exec    ActionExecutor
	read    ReadExecutor
	image   ImageExecutor
	pair    PairExecutor
	pairAck PairAckExecutor
	audit   AuditSink
	nonces  map[string]usedNonce
	ops     map[string]*idempotentOperation
	rates   map[string]rateWindow
}

// SetReadExecutor wires the local read facade after construction. Keeping the
// constructor backwards compatible avoids making paired-device storage depend
// on the mobile DTO layer.
func (s *Server) SetReadExecutor(executor ReadExecutor) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.read = executor
}

func (s *Server) SetImageExecutor(executor ImageExecutor) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.image = executor
}

func (s *Server) SetPairExecutor(executor PairExecutor) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pair = executor
}

func (s *Server) SetPairAckExecutor(executor PairAckExecutor) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pairAck = executor
}
func (s *Server) SetAuditSink(sink AuditSink) { s.mu.Lock(); defer s.mu.Unlock(); s.audit = sink }

func New(lookup SecretLookup, executors ...ActionExecutor) *Server {
	var executor ActionExecutor
	if len(executors) > 0 {
		executor = executors[0]
	}
	return &Server{lookup: lookup, exec: executor, nonces: make(map[string]usedNonce), ops: make(map[string]*idempotentOperation), rates: make(map[string]rateWindow)}
}

func (s *Server) allowRate(key string, limit int, window time.Duration) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	current := s.rates[key]
	if current.startedAt.IsZero() || now.Sub(current.startedAt) >= window {
		current = rateWindow{startedAt: now}
	}
	if current.count >= limit {
		s.rates[key] = current
		return false
	}
	current.count++
	s.rates[key] = current
	return true
}
func (s *Server) record(r *http.Request, deviceID, operation, outcome, detail string, status int) {
	s.mu.Lock()
	sink := s.audit
	s.mu.Unlock()
	if sink == nil {
		return
	}
	ip := remoteIP(r.RemoteAddr)
	source := ""
	if ip != nil {
		source = ip.String()
	}
	sink(r.Context(), AuditEvent{DeviceID: deviceID, SourceIP: source, Operation: operation, Outcome: outcome, Detail: detail, Status: status})
}

func (s *Server) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

// Start replaces a previous listener only when its port changes.
func (s *Server) Start(port int) error {
	if port < 1024 || port > 65535 {
		return fmt.Errorf("invalid LAN relay port")
	}
	s.mu.Lock()
	if s.server != nil && s.status.Port == port {
		s.status.Error = ""
		s.mu.Unlock()
		return nil
	}
	previous := s.server
	previousBonjour := s.bonjour
	s.server = nil
	s.bonjour = nil
	s.status = Status{Port: port}
	s.mu.Unlock()
	if previous != nil {
		_ = previous.Close()
	}
	if previousBonjour != nil && previousBonjour.Process != nil {
		_ = previousBonjour.Process.Kill()
	}

	listener, err := net.Listen("tcp4", fmt.Sprintf("0.0.0.0:%d", port))
	if err != nil {
		s.mu.Lock()
		s.status.Error = err.Error()
		s.mu.Unlock()
		return err
	}

	privateMux := http.NewServeMux()
	privateMux.HandleFunc(healthPath, s.health)
	privateMux.HandleFunc("/lan/v1/actions", s.action)
	privateMux.HandleFunc("/lan/v1/reads/", s.readResource)
	mux := http.NewServeMux()
	// <img> cannot attach our normal HMAC headers. Image URLs therefore carry
	// a separate, short-lived signature while retaining the private-IP gate.
	mux.Handle("/lan/v1/images/", s.privateImageOnly(http.HandlerFunc(s.serveImage)))
	// Pairing is still limited to private source addresses, but uses its
	// short-lived challenge instead of an unavailable pre-pair HMAC secret.
	mux.HandleFunc("/lan/v1/pair", s.pairDevice)
	mux.HandleFunc("/lan/v1/pair/ack", s.ackPairDevice)
	mux.Handle("/lan/v1/", s.privateOnly(privateMux))
	httpServer := &http.Server{
		Handler:           s.privateOnlyForPairing(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       30 * time.Second,
	}
	s.mu.Lock()
	s.server = httpServer
	s.status = Status{Running: true, Port: port}
	s.mu.Unlock()
	// macOS ships dns-sd as the system Bonjour publisher.  It is intentionally
	// best-effort: failing discovery must not make an explicitly configured QR
	// address unavailable.  Bonjour only advertises an endpoint; HMAC still
	// authenticates every post-pair request.
	if command := exec.Command("dns-sd", "-R", "Atolla", "_atolla._tcp", "local.", fmt.Sprintf("%d", port), "version=1"); command.Start() == nil {
		s.mu.Lock()
		s.bonjour = command
		s.status.Bonjour = true
		s.mu.Unlock()
	}
	go func() {
		err := httpServer.Serve(listener)
		if err != nil && err != http.ErrServerClosed {
			s.mu.Lock()
			s.status = Status{Port: port, Error: err.Error()}
			s.mu.Unlock()
		}
	}()
	return nil
}

func (s *Server) pairDevice(w http.ResponseWriter, r *http.Request) {
	if !s.allowRate("pair:"+r.RemoteAddr, 5, 10*time.Minute) {
		s.record(r, "", "pair", "rate_limited", "pairing rate limit", http.StatusTooManyRequests)
		writeJSONError(w, http.StatusTooManyRequests, "too many pairing attempts")
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s.mu.Lock()
	executor := s.pair
	s.mu.Unlock()
	if executor == nil {
		http.Error(w, "pairing unavailable", http.StatusServiceUnavailable)
		return
	}
	var request struct {
		SessionID string `json:"session_id"`
		Challenge string `json:"challenge"`
		ClientKey string `json:"client_key"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&request); err != nil || strings.TrimSpace(request.SessionID) == "" || strings.TrimSpace(request.Challenge) == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid pairing payload")
		return
	}
	deviceID, secret, err := executor(r.Context(), request.SessionID, request.Challenge, request.ClientKey)
	if err != nil {
		s.record(r, "", "pair", "rejected", "session invalid or used", http.StatusGone)
		writeJSONError(w, http.StatusGone, err.Error())
		return
	}
	s.record(r, deviceID, "pair", "success", "", http.StatusOK)
	writeRawJSON(w, http.StatusOK, mustJSON(map[string]any{"ok": true, "device_id": deviceID, "device_secret": secret}))
}

// ackPairDevice marks the QR as scanned. It is best-effort signalling for the
// desktop UI and returns no credential, so an attacker gains nothing by
// calling it with a guessed session.
func (s *Server) ackPairDevice(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.allowRate("pair-ack:"+r.RemoteAddr, 20, 10*time.Minute) {
		writeJSONError(w, http.StatusTooManyRequests, "too many pairing attempts")
		return
	}
	s.mu.Lock()
	executor := s.pairAck
	s.mu.Unlock()
	if executor == nil {
		http.Error(w, "pairing unavailable", http.StatusServiceUnavailable)
		return
	}
	var request struct {
		SessionID string `json:"session_id"`
		Challenge string `json:"challenge"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&request); err != nil || strings.TrimSpace(request.SessionID) == "" || strings.TrimSpace(request.Challenge) == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid pairing payload")
		return
	}
	if err := executor(r.Context(), request.SessionID, request.Challenge); err != nil {
		s.record(r, "", "pair:scan", "rejected", "session invalid or expired", http.StatusGone)
		writeJSONError(w, http.StatusGone, "pairing session expired or invalid")
		return
	}
	s.record(r, "", "pair:scan", "success", "", http.StatusOK)
	writeRawJSON(w, http.StatusOK, mustJSON(map[string]any{"ok": true}))
}

func mustJSON(value any) []byte { body, _ := json.Marshal(value); return body }

func (s *Server) action(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.exec == nil {
		http.Error(w, "LAN actions unavailable", http.StatusServiceUnavailable)
		return
	}
	deviceID := strings.TrimSpace(r.Header.Get("X-Atolla-Device"))
	if !s.allowRate("action:"+deviceID, 30, time.Minute) {
		s.record(r, deviceID, "action", "rate_limited", "action rate limit", http.StatusTooManyRequests)
		writeJSONError(w, http.StatusTooManyRequests, "too many actions")
		return
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("X-Atolla-Idempotency-Key"))
	if !validIdempotencyKey(idempotencyKey) {
		writeJSONError(w, http.StatusBadRequest, "valid idempotency key required")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxActionBody))
	if err != nil {
		writeJSONError(w, http.StatusRequestEntityTooLarge, "action payload too large")
		return
	}
	var input struct {
		Action  string         `json:"action"`
		Payload map[string]any `json:"payload"`
	}
	if err := json.Unmarshal(body, &input); err != nil || strings.TrimSpace(input.Action) == "" {
		writeJSONError(w, http.StatusBadRequest, "invalid action payload")
		return
	}
	fingerprint := actionFingerprint(input.Action, body)
	operation, owner, conflict := s.acquireOperation(deviceID, idempotencyKey, fingerprint, time.Now())
	if conflict {
		writeJSONError(w, http.StatusConflict, "idempotency key conflicts with a different action")
		return
	}
	if !owner {
		select {
		case <-operation.done:
			writeRawJSON(w, operation.status, operation.body)
		case <-r.Context().Done():
			// The caller cannot know whether the first execution will finish.
			// It must not interpret this as permission to replay via cloud.
			writeJSONError(w, http.StatusGatewayTimeout, "action outcome is still pending")
		}
		return
	}

	result, execErr := s.exec(r.Context(), input.Action, input.Payload)
	status, response := actionResponse(result, execErr)
	s.completeOperation(operation, status, response, time.Now())
	s.record(r, deviceID, "action:"+input.Action, map[bool]string{true: "success", false: "rejected"}[execErr == nil], "", status)
	writeRawJSON(w, status, response)
}

func actionResponse(result any, err error) (int, []byte) {
	if err != nil {
		body, marshalErr := json.Marshal(map[string]any{"ok": false, "error": err.Error()})
		if marshalErr != nil {
			return http.StatusInternalServerError, []byte(`{"ok":false,"error":"action failed"}`)
		}
		return http.StatusBadRequest, body
	}
	body, marshalErr := json.Marshal(map[string]any{"ok": true, "result": result})
	if marshalErr != nil {
		return http.StatusInternalServerError, []byte(`{"ok":false,"error":"action response serialization failed"}`)
	}
	return http.StatusOK, body
}

func writeJSONError(w http.ResponseWriter, status int, message string) {
	body, _ := json.Marshal(map[string]any{"ok": false, "error": message})
	writeRawJSON(w, status, body)
}

func writeRawJSON(w http.ResponseWriter, status int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func validIdempotencyKey(key string) bool {
	if len(key) < 1 || len(key) > 128 {
		return false
	}
	for _, ch := range key {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_') {
			return false
		}
	}
	return true
}

func actionFingerprint(action string, body []byte) string {
	digest := sha256.Sum256(body)
	return strings.TrimSpace(action) + "\x00" + hex.EncodeToString(digest[:])
}

func (s *Server) acquireOperation(deviceID, key, fingerprint string, now time.Time) (*idempotentOperation, bool, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for operationKey, operation := range s.ops {
		if operation.done != nil && operation.expiresAt.Before(now) {
			select {
			case <-operation.done:
				delete(s.ops, operationKey)
			default:
			}
		}
	}
	operationKey := deviceID + "\x00" + key
	if existing := s.ops[operationKey]; existing != nil {
		if existing.fingerprint != fingerprint {
			return nil, false, true
		}
		return existing, false, false
	}
	if len(s.ops) >= maxRememberOps {
		return nil, false, true
	}
	operation := &idempotentOperation{fingerprint: fingerprint, done: make(chan struct{}), expiresAt: now.Add(operationLifetime)}
	s.ops[operationKey] = operation
	return operation, true, false
}

func (s *Server) completeOperation(operation *idempotentOperation, status int, body []byte, now time.Time) {
	s.mu.Lock()
	operation.status = status
	operation.body = append([]byte(nil), body...)
	operation.expiresAt = now.Add(operationLifetime)
	close(operation.done)
	s.mu.Unlock()
}

func (s *Server) readResource(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s.mu.Lock()
	executor := s.read
	s.mu.Unlock()
	if executor == nil {
		http.Error(w, "LAN reads unavailable", http.StatusServiceUnavailable)
		return
	}
	resource := strings.TrimPrefix(r.URL.Path, "/lan/v1/reads/")
	deviceID := strings.TrimSpace(r.Header.Get("X-Atolla-Device"))
	if !s.allowRate("read:"+deviceID, readRequestsPerMinute, time.Minute) {
		s.record(r, deviceID, "read", "rate_limited", "read rate limit", http.StatusTooManyRequests)
		writeJSONError(w, http.StatusTooManyRequests, "too many reads")
		return
	}
	resource = strings.Trim(resource, "/")
	if resource == "" || strings.Contains(resource, "//") {
		http.Error(w, "invalid LAN read resource", http.StatusBadRequest)
		return
	}
	result, err := executor(r.Context(), resource, r.URL.Query())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
	s.record(r, deviceID, "read:"+resource, "success", "", http.StatusOK)
}

func (s *Server) serveImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/lan/v1/images/")
	if !validImageName(name) {
		http.Error(w, "invalid image name", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	executor := s.image
	s.mu.Unlock()
	if executor == nil {
		http.Error(w, "LAN images unavailable", http.StatusServiceUnavailable)
		return
	}
	image, err := executor(r.Context(), name)
	if err != nil {
		http.Error(w, "image not found", http.StatusNotFound)
		return
	}
	if len(image.Data) == 0 || len(image.Data) > 8<<20 {
		http.Error(w, "invalid image", http.StatusBadGateway)
		return
	}
	contentType := strings.TrimSpace(image.ContentType)
	if contentType == "" {
		contentType = "image/jpeg"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(image.Data)
}

func (s *Server) Stop() {
	s.mu.Lock()
	server := s.server
	bonjour := s.bonjour
	s.server = nil
	s.bonjour = nil
	s.status = Status{}
	s.mu.Unlock()
	if server != nil {
		_ = server.Close()
	}
	if bonjour != nil && bonjour.Process != nil {
		_ = bonjour.Process.Kill()
	}
}

func (s *Server) privateOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := remoteIP(r.RemoteAddr)
		// A router port-forward does not make the request trusted. Requiring a
		// private source address blocks direct public access by default.
		if ip == nil || !ip.IsPrivate() {
			s.record(r, "", "request", "rejected", "non-private source", http.StatusForbidden)
			http.Error(w, "LAN relay only accepts private network clients", http.StatusForbidden)
			return
		}
		if !s.verify(r) {
			s.record(r, strings.TrimSpace(r.Header.Get("X-Atolla-Device")), "request", "rejected", "signature invalid", http.StatusUnauthorized)
			http.Error(w, "invalid LAN relay signature", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) privateOnlyForPairing(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := remoteIP(r.RemoteAddr)
		if ip == nil || !ip.IsPrivate() {
			http.Error(w, "LAN relay only accepts private network clients", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// privateImageOnly authenticates an expiring image URL. Query authentication
// is deliberately narrower than the header protocol because an HTML image tag
// cannot send custom headers. It accepts no body and never authorizes actions.
func (s *Server) privateImageOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := remoteIP(r.RemoteAddr)
		if ip == nil || !ip.IsPrivate() {
			http.Error(w, "LAN relay only accepts private network clients", http.StatusForbidden)
			return
		}
		if !s.verifyImageURL(r) {
			s.record(r, strings.TrimSpace(r.URL.Query().Get("device_id")), "image", "rejected", "image signature invalid", http.StatusUnauthorized)
			http.Error(w, "invalid LAN image signature", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true,"transport":"lan","version":1}`))
}

func (s *Server) verify(r *http.Request) bool {
	deviceID := strings.TrimSpace(r.Header.Get("X-Atolla-Device"))
	timestamp := strings.TrimSpace(r.Header.Get("X-Atolla-Timestamp"))
	nonce := strings.TrimSpace(r.Header.Get("X-Atolla-Nonce"))
	signature := strings.TrimSpace(r.Header.Get("X-Atolla-Signature"))
	if deviceID == "" || timestamp == "" || nonce == "" || signature == "" || len(nonce) > 128 {
		return false
	}
	issuedAt, err := time.Parse(time.RFC3339, timestamp)
	if err != nil || time.Since(issuedAt).Abs() > maxClockSkew {
		return false
	}
	secret, active, err := s.lookup(r.Context(), deviceID)
	if err != nil || !active || secret == "" {
		return false
	}
	bodyDigest, ok := requestBodySHA256(r)
	if !ok {
		return false
	}
	// Query parameters select pagination/filtering for read resources, so they
	// must be authenticated too. Signing only the path would allow a caller to
	// alter an otherwise valid read after signing it.
	canonicalParts := []string{r.Method, canonicalTarget(r.URL), timestamp, nonce, bodyDigest}
	if idempotencyKey := strings.TrimSpace(r.Header.Get("X-Atolla-Idempotency-Key")); idempotencyKey != "" {
		canonicalParts = append(canonicalParts, idempotencyKey)
	}
	canonical := strings.Join(canonicalParts, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonical))
	expected := mac.Sum(nil)
	provided, err := hex.DecodeString(signature)
	if err != nil || !hmac.Equal(expected, provided) {
		return false
	}
	return s.markNonceUsed(deviceID, nonce, time.Now())
}

func (s *Server) verifyImageURL(r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}
	deviceID := strings.TrimSpace(r.URL.Query().Get("device_id"))
	expiresRaw := strings.TrimSpace(r.URL.Query().Get("expires"))
	signature := strings.TrimSpace(r.URL.Query().Get("signature"))
	if deviceID == "" || signature == "" {
		return false
	}
	expiresAt, err := strconv.ParseInt(expiresRaw, 10, 64)
	if err != nil || expiresAt <= time.Now().Unix() || expiresAt > time.Now().Add(imageURLLifetime).Unix() {
		return false
	}
	secret, active, err := s.lookup(r.Context(), deviceID)
	if err != nil || !active || secret == "" {
		return false
	}
	canonical := imageURLCanonical(r.URL.EscapedPath(), deviceID, expiresAt)
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonical))
	expected := mac.Sum(nil)
	provided, err := hex.DecodeString(signature)
	return err == nil && hmac.Equal(expected, provided)
}

func imageURLCanonical(escapedPath, deviceID string, expiresAt int64) string {
	return strings.Join([]string{http.MethodGet, escapedPath, deviceID, strconv.FormatInt(expiresAt, 10)}, "\n")
}

func validImageName(name string) bool {
	if name == "" || strings.ContainsAny(name, `/\\`) || strings.Contains(name, "..") {
		return false
	}
	lower := strings.ToLower(name)
	return strings.HasSuffix(lower, ".jpg") || strings.HasSuffix(lower, ".jpeg") || strings.HasSuffix(lower, ".png") || strings.HasSuffix(lower, ".webp")
}

func canonicalTarget(u *url.URL) string {
	if u == nil {
		return ""
	}
	if u.RawQuery == "" {
		return u.EscapedPath()
	}
	return u.EscapedPath() + "?" + u.RawQuery
}

// requestBodySHA256 restores the request body after signing it, so downstream
// LAN handlers receive precisely the bytes authenticated by this middleware.
func requestBodySHA256(r *http.Request) (string, bool) {
	if r.Body == nil {
		return emptyBodySHA256, true
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxActionBody+1))
	if err != nil {
		return "", false
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:]), true
}

const emptyBodySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

func (s *Server) markNonceUsed(deviceID, nonce string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, value := range s.nonces {
		if !value.expiresAt.After(now) {
			delete(s.nonces, key)
		}
	}
	key := deviceID + "\x00" + nonce
	if _, exists := s.nonces[key]; exists {
		return false
	}
	if len(s.nonces) >= maxRememberNonce {
		return false
	}
	s.nonces[key] = usedNonce{expiresAt: now.Add(nonceLifetime)}
	return true
}

func remoteIP(remoteAddr string) net.IP {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return nil
	}
	return net.ParseIP(host)
}
