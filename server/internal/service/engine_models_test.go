package service

import (
	"strings"
	"testing"
)

func TestParseAgentModelsOutput(t *testing.T) {
	raw := "Available models\n\nauto - Auto (current, default)\ncomposer-2.5 - Composer 2.5\n"
	items, def := parseAgentModelsOutput(raw)
	if def != "auto" {
		t.Fatalf("default=%q", def)
	}
	if len(items) != 2 || items[0].ID != "auto" || items[1].ID != "composer-2.5" {
		t.Fatalf("items=%+v", items)
	}
}

func TestParseCodexModelsCacheVisibility(t *testing.T) {
	raw := []byte(`{"models":[
		{"slug":"gpt-6.2-sol","display_name":"GPT-6.2-Sol","description":"Fast","visibility":"list"},
		{"slug":"gpt-reserve","display_name":"GPT-Reserve","visibility":"hide"},
		{"slug":"codex-auto-review","display_name":"Auto","visibility":"hide"}
	]}`)
	items, err := parseCodexModelsCache(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != "gpt-6.2-sol" {
		t.Fatalf("items=%+v", items)
	}
	if !strings.Contains(items[0].Label, "Fast") {
		t.Fatalf("label=%q", items[0].Label)
	}
}

func TestSplitModelDashLine(t *testing.T) {
	id, label, ok := splitModelDashLine("foo - Bar - Baz")
	if !ok || id != "foo" || label != "Bar - Baz" {
		t.Fatalf("%q %q %v", id, label, ok)
	}
	if _, _, ok := splitModelDashLine("no dash"); ok {
		t.Fatal("expected fail")
	}
}
