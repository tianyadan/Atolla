package store

import (
	"context"
	"path/filepath"
	"testing"
)

func TestGetOrCreateSystemVisitorIsStable(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "system-visitor.db"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	first, err := st.GetOrCreateSystemVisitor(ctx, "atolla-siri", "Siri")
	if err != nil {
		t.Fatal(err)
	}
	second, err := st.GetOrCreateSystemVisitor(ctx, "atolla-siri", "Siri")
	if err != nil {
		t.Fatal(err)
	}
	if first == nil || second == nil || first.ID != second.ID || first.PublicID != "atolla-siri" {
		t.Fatalf("expected stable visitor, first=%+v second=%+v", first, second)
	}
}
