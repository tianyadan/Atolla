package lanrelay

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestPairAckReportsScanWithoutReturningCredentials(t *testing.T) {
	s := New(nil)
	var sessionID, challenge string
	s.SetPairAckExecutor(func(_ context.Context, id, ch string) error {
		sessionID, challenge = id, ch
		return nil
	})
	request := httptest.NewRequest(http.MethodPost, "/lan/v1/pair/ack", strings.NewReader(`{"session_id":"pair-1","challenge":"challenge-1"}`))
	request.RemoteAddr = "192.168.1.42:55123"
	recorder := httptest.NewRecorder()
	s.ackPairDevice(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if sessionID != "pair-1" || challenge != "challenge-1" {
		t.Fatalf("executor got session=%q challenge=%q", sessionID, challenge)
	}
	if body := recorder.Body.String(); strings.Contains(body, "secret") {
		t.Fatalf("ack response must not expose a secret: %s", body)
	}
}

func TestPairAckRejectsExpiredSession(t *testing.T) {
	s := New(nil)
	s.SetPairAckExecutor(func(context.Context, string, string) error { return context.Canceled })
	request := httptest.NewRequest(http.MethodPost, "/lan/v1/pair/ack", strings.NewReader(`{"session_id":"pair-1","challenge":"challenge-1"}`))
	request.RemoteAddr = "192.168.1.42:55123"
	recorder := httptest.NewRecorder()
	s.ackPairDevice(recorder, request)
	if recorder.Code != http.StatusGone {
		t.Fatalf("status=%d body=%s, want 410", recorder.Code, recorder.Body.String())
	}
}

func TestPrivateSignedHealthAndReplayProtection(t *testing.T) {
	secret := "test-secret"
	s := New(func(_ context.Context, deviceID string) (string, bool, error) {
		return secret, deviceID == "iphone-1", nil
	})
	mux := http.NewServeMux()
	mux.HandleFunc(healthPath, s.health)
	handler := s.privateOnly(mux)

	request := signedRequest(t, secret, "iphone-1", "nonce-1")
	request.RemoteAddr = "192.168.1.42:55123"
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, request)
	if first.Code != http.StatusOK {
		t.Fatalf("first request status=%d body=%s", first.Code, first.Body.String())
	}

	replay := signedRequest(t, secret, "iphone-1", "nonce-1")
	replay.RemoteAddr = "192.168.1.42:55123"
	second := httptest.NewRecorder()
	handler.ServeHTTP(second, replay)
	if second.Code != http.StatusUnauthorized {
		t.Fatalf("replay status=%d", second.Code)
	}

	public := signedRequest(t, secret, "iphone-1", "nonce-2")
	public.RemoteAddr = "8.8.8.8:443"
	third := httptest.NewRecorder()
	handler.ServeHTTP(third, public)
	if third.Code != http.StatusForbidden {
		t.Fatalf("public status=%d", third.Code)
	}
}

func TestVerifyAcceptsSignedRequestBody(t *testing.T) {
	s := New(func(_ context.Context, _ string) (string, bool, error) { return "test-secret", true, nil })
	body := []byte(`{"action":"agent.ask"}`)
	req := signedRequest(t, "test-secret", "iphone-1", "nonce-body")
	req.Method = http.MethodPost
	req.Body = io.NopCloser(bytes.NewReader(body))
	req.Header.Set("X-Atolla-Signature", signRequest(t, "test-secret", req.Method, healthPath, req.Header.Get("X-Atolla-Timestamp"), "nonce-body", body))
	if !s.verify(req) {
		t.Fatal("expected signed body request to verify")
	}
}

func TestSignedImageURLServesOnlyUntamperedPrivateRequests(t *testing.T) {
	secret := "test-secret"
	s := New(func(_ context.Context, deviceID string) (string, bool, error) {
		return secret, deviceID == "iphone-1", nil
	})
	s.SetImageExecutor(func(_ context.Context, imageName string) (Image, error) {
		if imageName != "chat-1.jpg" {
			t.Fatalf("unexpected image name: %s", imageName)
		}
		return Image{Data: []byte("image-bytes"), ContentType: "image/jpeg"}, nil
	})

	expiresAt := time.Now().Add(time.Minute).Unix()
	target := signedImageTarget(t, secret, "iphone-1", "/lan/v1/images/chat-1.jpg", expiresAt)
	req := httptest.NewRequest(http.MethodGet, "http://lan.test"+target, nil)
	req.RemoteAddr = "192.168.1.42:55123"
	good := httptest.NewRecorder()
	s.privateImageOnly(http.HandlerFunc(s.serveImage)).ServeHTTP(good, req)
	if good.Code != http.StatusOK || good.Body.String() != "image-bytes" {
		t.Fatalf("signed image status=%d body=%q", good.Code, good.Body.String())
	}

	tampered := httptest.NewRequest(http.MethodGet, "http://lan.test"+target+"x", nil)
	tampered.RemoteAddr = "192.168.1.42:55123"
	denied := httptest.NewRecorder()
	s.privateImageOnly(http.HandlerFunc(s.serveImage)).ServeHTTP(denied, tampered)
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("tampered image status=%d, want %d", denied.Code, http.StatusUnauthorized)
	}
}

func TestSignedReadAuthenticatesQueryAndUsesReadFacade(t *testing.T) {
	secret := "test-secret"
	s := New(func(_ context.Context, _ string) (string, bool, error) { return secret, true, nil })
	s.SetReadExecutor(func(_ context.Context, resource string, query url.Values) (any, error) {
		if resource != "messages" || query.Get("agent_id") != "7" {
			t.Fatalf("unexpected read: resource=%s query=%s", resource, query.Encode())
		}
		return map[string]any{"messages": []any{}}, nil
	})
	mux := http.NewServeMux()
	mux.HandleFunc("/lan/v1/reads/", s.readResource)
	handler := s.privateOnly(mux)

	target := "/lan/v1/reads/messages?agent_id=7&limit=20"
	req := signedRequestTo(t, secret, "iphone-1", "nonce-read", target)
	req.RemoteAddr = "192.168.1.42:55123"
	resp := httptest.NewRecorder()
	handler.ServeHTTP(resp, req)
	if resp.Code != http.StatusOK {
		t.Fatalf("read status=%d body=%s", resp.Code, resp.Body.String())
	}

	// A signature for one pagination/filter query must not authenticate another.
	tampered := signedRequestTo(t, secret, "iphone-1", "nonce-tampered", target)
	tampered.URL.RawQuery = "agent_id=8&limit=20"
	tampered.RequestURI = tampered.URL.RequestURI()
	tampered.RemoteAddr = "192.168.1.42:55123"
	denied := httptest.NewRecorder()
	handler.ServeHTTP(denied, tampered)
	if denied.Code != http.StatusUnauthorized {
		t.Fatalf("tampered query status=%d", denied.Code)
	}
}

func TestActionIdempotencyRunsExecutorOnceForConcurrentRetry(t *testing.T) {
	secret := "test-secret"
	started := make(chan struct{})
	release := make(chan struct{})
	var executions atomic.Int32
	s := New(
		func(_ context.Context, _ string) (string, bool, error) { return secret, true, nil },
		func(_ context.Context, _ string, _ map[string]any) (any, error) {
			if executions.Add(1) == 1 {
				close(started)
			}
			<-release
			return map[string]any{"accepted": true}, nil
		},
	)
	mux := http.NewServeMux()
	mux.HandleFunc("/lan/v1/actions", s.action)
	handler := s.privateOnly(mux)
	body := []byte(`{"action":"agent.ask","payload":{"agent_id":"7","question":"hello"}}`)

	firstDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		req := signedActionRequest(t, secret, "nonce-first", "op-123", body)
		req.RemoteAddr = "192.168.1.42:55123"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		firstDone <- rec
	}()
	<-started

	secondDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		req := signedActionRequest(t, secret, "nonce-second", "op-123", body)
		req.RemoteAddr = "192.168.1.42:55123"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		secondDone <- rec
	}()

	// The duplicate must wait for the first result rather than enter the
	// executor while its outcome is still unknown.
	time.Sleep(30 * time.Millisecond)
	if got := executions.Load(); got != 1 {
		t.Fatalf("executions before first completion = %d, want 1", got)
	}
	close(release)
	for _, done := range []chan *httptest.ResponseRecorder{firstDone, secondDone} {
		if rec := <-done; rec.Code != http.StatusOK {
			t.Fatalf("action status=%d body=%s", rec.Code, rec.Body.String())
		}
	}
	if got := executions.Load(); got != 1 {
		t.Fatalf("executions after retry = %d, want 1", got)
	}
}

func TestActionIdempotencyReplaysCompletedResultAndRejectsConflicts(t *testing.T) {
	secret := "test-secret"
	var executions atomic.Int32
	s := New(
		func(_ context.Context, _ string) (string, bool, error) { return secret, true, nil },
		func(_ context.Context, _ string, _ map[string]any) (any, error) {
			executions.Add(1)
			return map[string]any{"sequence": 1}, nil
		},
	)
	mux := http.NewServeMux()
	mux.HandleFunc("/lan/v1/actions", s.action)
	handler := s.privateOnly(mux)
	body := []byte(`{"action":"agent.ask","payload":{"agent_id":"7","question":"hello"}}`)

	serve := func(nonce string, actionBody []byte) *httptest.ResponseRecorder {
		req := signedActionRequest(t, secret, nonce, "op-456", actionBody)
		req.RemoteAddr = "192.168.1.42:55123"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}
	first := serve("nonce-original", body)
	if first.Code != http.StatusOK {
		t.Fatalf("first status=%d body=%s", first.Code, first.Body.String())
	}
	retry := serve("nonce-retry", body)
	if retry.Code != http.StatusOK || retry.Body.String() != first.Body.String() {
		t.Fatalf("retry status=%d body=%s, want cached=%s", retry.Code, retry.Body.String(), first.Body.String())
	}
	if got := executions.Load(); got != 1 {
		t.Fatalf("executions after completed retry=%d, want 1", got)
	}

	conflict := serve("nonce-conflict", []byte(`{"action":"agent.ask","payload":{"agent_id":"7","question":"different"}}`))
	if conflict.Code != http.StatusConflict {
		t.Fatalf("conflict status=%d body=%s", conflict.Code, conflict.Body.String())
	}
	if got := executions.Load(); got != 1 {
		t.Fatalf("executions after conflict=%d, want 1", got)
	}
}

func TestActionIdempotencyRequiresSignedKey(t *testing.T) {
	secret := "test-secret"
	s := New(
		func(_ context.Context, _ string) (string, bool, error) { return secret, true, nil },
		func(_ context.Context, _ string, _ map[string]any) (any, error) {
			return map[string]any{"ok": true}, nil
		},
	)
	mux := http.NewServeMux()
	mux.HandleFunc("/lan/v1/actions", s.action)
	handler := s.privateOnly(mux)
	body := []byte(`{"action":"agent.ask","payload":{"agent_id":"7"}}`)

	missing := signedActionRequest(t, secret, "nonce-missing", "op-789", body)
	missing.Header.Del("X-Atolla-Idempotency-Key")
	missing.RemoteAddr = "192.168.1.42:55123"
	missingRec := httptest.NewRecorder()
	handler.ServeHTTP(missingRec, missing)
	if missingRec.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned key removal status=%d body=%s", missingRec.Code, missingRec.Body.String())
	}

	tampered := signedActionRequest(t, secret, "nonce-tampered-key", "op-789", body)
	tampered.Header.Set("X-Atolla-Idempotency-Key", "op-replaced")
	tampered.RemoteAddr = "192.168.1.42:55123"
	tamperedRec := httptest.NewRecorder()
	handler.ServeHTTP(tamperedRec, tampered)
	if tamperedRec.Code != http.StatusUnauthorized {
		t.Fatalf("tampered key status=%d body=%s", tamperedRec.Code, tamperedRec.Body.String())
	}
}

func TestRateWindowRejectsRequestsAfterLimit(t *testing.T) {
	s := New(func(_ context.Context, _ string) (string, bool, error) { return "secret", true, nil })
	for i := 0; i < 3; i++ {
		if !s.allowRate("device:iphone-1", 3, time.Minute) {
			t.Fatalf("request %d unexpectedly limited", i+1)
		}
	}
	if s.allowRate("device:iphone-1", 3, time.Minute) {
		t.Fatal("fourth request should be rate limited")
	}
	if !s.allowRate("device:iphone-2", 3, time.Minute) {
		t.Fatal("another device must have an independent rate window")
	}
}

func TestReadRateLimitAllowsExpectedMobilePollingBurst(t *testing.T) {
	s := New(func(_ context.Context, _ string) (string, bool, error) { return "secret", true, nil })
	for i := 0; i < readRequestsPerMinute; i++ {
		if !s.allowRate("read:iphone-1", readRequestsPerMinute, time.Minute) {
			t.Fatalf("read %d unexpectedly limited", i+1)
		}
	}
	if s.allowRate("read:iphone-1", readRequestsPerMinute, time.Minute) {
		t.Fatal("read above the configured per-minute budget must be limited")
	}
}

func signedRequest(t *testing.T, secret, deviceID, nonce string) *http.Request {
	return signedRequestTo(t, secret, deviceID, nonce, healthPath)
}

func signedRequestTo(t *testing.T, secret, deviceID, nonce, target string) *http.Request {
	t.Helper()
	timestamp := time.Now().UTC().Format(time.RFC3339)
	signature := signRequest(t, secret, "GET", target, timestamp, nonce, nil)

	req := httptest.NewRequest(http.MethodGet, "http://lan.test"+target, nil)
	req.Header.Set("X-Atolla-Device", deviceID)
	req.Header.Set("X-Atolla-Timestamp", timestamp)
	req.Header.Set("X-Atolla-Nonce", nonce)
	req.Header.Set("X-Atolla-Signature", signature)
	return req
}

func signRequest(t *testing.T, secret, method, path, timestamp, nonce string, body []byte) string {
	t.Helper()
	digest := sha256.Sum256(body)
	canonical := method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + hex.EncodeToString(digest[:])
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonical))
	return hex.EncodeToString(mac.Sum(nil))
}

func signedImageTarget(t *testing.T, secret, deviceID, escapedPath string, expiresAt int64) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(imageURLCanonical(escapedPath, deviceID, expiresAt)))
	values := url.Values{}
	values.Set("device_id", deviceID)
	values.Set("expires", strconv.FormatInt(expiresAt, 10))
	values.Set("signature", hex.EncodeToString(mac.Sum(nil)))
	return escapedPath + "?" + values.Encode()
}

func signedActionRequest(t *testing.T, secret, nonce, idempotencyKey string, body []byte) *http.Request {
	t.Helper()
	timestamp := time.Now().UTC().Format(time.RFC3339)
	req := httptest.NewRequest(http.MethodPost, "http://lan.test/lan/v1/actions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Atolla-Device", "iphone-1")
	req.Header.Set("X-Atolla-Timestamp", timestamp)
	req.Header.Set("X-Atolla-Nonce", nonce)
	req.Header.Set("X-Atolla-Idempotency-Key", idempotencyKey)
	req.Header.Set("X-Atolla-Signature", signRequestWithIdempotencyKey(t, secret, http.MethodPost, "/lan/v1/actions", timestamp, nonce, body, idempotencyKey))
	return req
}

func signRequestWithIdempotencyKey(t *testing.T, secret, method, path, timestamp, nonce string, body []byte, idempotencyKey string) string {
	t.Helper()
	digest := sha256.Sum256(body)
	canonical := method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + hex.EncodeToString(digest[:]) + "\n" + idempotencyKey
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonical))
	return hex.EncodeToString(mac.Sum(nil))
}
