package enginecheck

import "testing"

func TestScanThreeEngines(t *testing.T) {
	list := Scan()
	if len(list) != 3 {
		t.Fatalf("len=%d", len(list))
	}
	want := []string{"claude", "codex", "cursor"}
	for i, id := range want {
		if list[i].ID != id || list[i].Name == "" || list[i].Bin == "" {
			t.Fatalf("item %d = %+v", i, list[i])
		}
	}
}
