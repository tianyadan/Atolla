package store

import (
	"errors"
	"testing"
)

func TestValidJellyColor(t *testing.T) {
	for _, c := range JellyColors {
		if !ValidJellyColor(c) {
			t.Fatalf("expected valid %q", c)
		}
		if !ValidJellyColor(" " + c + " ") {
			t.Fatalf("trim %q", c)
		}
		if !ValidJellyColor(toUpperFirst(c)) {
			t.Fatalf("case %q", c)
		}
	}
	for _, bad := range []string{"", "pink", "ORANGE!", "teal", "blueish"} {
		if ValidJellyColor(bad) {
			t.Fatalf("expected invalid %q", bad)
		}
	}
}

func toUpperFirst(s string) string {
	if s == "" {
		return s
	}
	b := []byte(s)
	if b[0] >= 'a' && b[0] <= 'z' {
		b[0] -= 32
	}
	return string(b)
}

func TestNormalizeJellyColor(t *testing.T) {
	if NormalizeJellyColor(" Blue ") != "blue" {
		t.Fatal(NormalizeJellyColor(" Blue "))
	}
	if NormalizeJellyColor("cyan") != "" {
		t.Fatal("cyan should normalize empty")
	}
}

func TestAssignJellyColorStableRotation(t *testing.T) {
	// 与 migrate_v0.5.10.sql 的 ELT(MOD(id,6)+1, ...) 对齐。
	want := map[int64]string{
		0: "orange",
		1: "yellow",
		2: "blue",
		3: "green",
		4: "purple",
		5: "red",
		6: "orange",
		7: "yellow",
		12: "orange",
	}
	for id, c := range want {
		if got := AssignJellyColor(id); got != c {
			t.Fatalf("id=%d got %q want %q", id, got, c)
		}
	}
	if AssignJellyColor(-3) != AssignJellyColor(3) {
		t.Fatal("negative id should mirror")
	}
	// 连续 id 应轮转分散。
	seen := map[string]bool{}
	for id := int64(1); id <= 6; id++ {
		seen[AssignJellyColor(id)] = true
	}
	if len(seen) != 6 {
		t.Fatalf("want 6 distinct in a cycle, got %d", len(seen))
	}
}

func TestResolveJellyColor(t *testing.T) {
	got, err := ResolveJellyColor(2, "")
	if err != nil || got != "blue" {
		t.Fatalf("auto: %q %v", got, err)
	}
	got, err = ResolveJellyColor(2, "RED")
	if err != nil || got != "red" {
		t.Fatalf("explicit: %q %v", got, err)
	}
	_, err = ResolveJellyColor(2, "pink")
	if !errors.Is(err, ErrInvalidJellyColor) {
		t.Fatalf("want ErrInvalidJellyColor, got %v", err)
	}
}

func TestBackfillJellyColorAssignmentMatchesSQL(t *testing.T) {
	// 文档/迁移约定：空色回填 = AssignJellyColor(id)。
	for id := int64(0); id < 24; id++ {
		c := AssignJellyColor(id)
		if !ValidJellyColor(c) {
			t.Fatalf("assigned invalid for %d", id)
		}
		idx := int(id % 6)
		if c != JellyColors[idx] {
			t.Fatalf("id=%d", id)
		}
	}
}
