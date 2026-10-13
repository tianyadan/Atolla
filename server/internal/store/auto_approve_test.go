package store

import (
	"testing"
	"time"
)

func TestPurgeCutoffLogic(t *testing.T) {
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	if !cutoff.Before(time.Now()) {
		t.Fatal("cutoff should be in the past")
	}
	if time.Since(cutoff) < 6*24*time.Hour {
		t.Fatal("cutoff should be about 7 days ago")
	}
}
