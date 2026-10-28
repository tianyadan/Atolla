package service

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"atolla/server/internal/store"
)

func openNotifyPrefsTestStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.NewWithDriver(store.DriverSQLite, filepath.Join(t.TempDir(), "notify.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	return st
}

func TestConfirmNotifyBarkOTPSuccess(t *testing.T) {
	st := openNotifyPrefsTestStore(t)
	s := &Service{Store: st}
	s.notifyOTP = &notifyBarkOTP{
		code:      "123456",
		expiresAt: time.Now().Add(time.Minute),
		sentAt:    time.Now(),
	}
	if err := s.ConfirmNotifyBarkOTP(context.Background(), "123456"); err != nil {
		t.Fatal(err)
	}
	prefs, err := st.GetNotifyPrefs(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !prefs.BarkVerified {
		t.Fatal("want bark verified")
	}
}

func TestSaveNotifyPrefsRequiresBarkVerified(t *testing.T) {
	st := openNotifyPrefsTestStore(t)
	s := &Service{Store: st}
	err := s.SaveNotifyPrefs(context.Background(), store.NotifyPrefs{TaskDone: true})
	if err == nil || !strings.Contains(err.Error(), "Bark 验证") {
		t.Fatalf("want unverified error, got %v", err)
	}
	if err := st.SetBarkVerified(context.Background(), true); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveNotifyPrefs(context.Background(), store.NotifyPrefs{TaskDone: true}); err != nil {
		t.Fatal(err)
	}
}

func TestConfirmNotifyBarkOTPWrongCode(t *testing.T) {
	st := openNotifyPrefsTestStore(t)
	s := &Service{Store: st}
	s.notifyOTP = &notifyBarkOTP{
		code:      "123456",
		expiresAt: time.Now().Add(time.Minute),
		sentAt:    time.Now(),
	}
	err := s.ConfirmNotifyBarkOTP(context.Background(), "000000")
	if err == nil || !strings.Contains(err.Error(), "验证码错误") {
		t.Fatalf("got %v", err)
	}
}
