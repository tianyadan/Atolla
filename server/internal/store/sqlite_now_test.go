package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"
)

func TestSQLiteNowUsesUTCInstant(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "now.db"))
	if err != nil {
		t.Fatalf("open sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = st.db.Close() })

	var got time.Time
	if err := st.db.QueryRowContext(context.Background(), `SELECT NOW()`).Scan(&got); err != nil {
		t.Fatalf("select NOW(): %v", err)
	}
	if delta := time.Since(got); delta < -2*time.Second || delta > 2*time.Second {
		t.Fatalf("NOW()=%v differs from current instant by %v", got, delta)
	}
}
