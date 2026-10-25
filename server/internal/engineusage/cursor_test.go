package engineusage

import "testing"

func TestMapCursorResponseIncludesAdditionalUsageWindows(t *testing.T) {
	raw := []byte(`{
  "membershipType":"Pro",
  "individualUsage": {
    "plan": {"totalPercentUsed": 0.42, "autoPercentUsed": 0.18},
    "thirdPartyAPI": {"displayName":"第三方 API", "usedPercent":0.27},
    "grokBot": {"label":"Grok Bot", "totalPercentUsed":62}
  }
}`)

	mapped, err := MapCursorResponse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if mapped.Plan != "Pro" {
		t.Fatalf("plan=%q", mapped.Plan)
	}
	if len(mapped.Windows) != 4 {
		t.Fatalf("windows=%+v", mapped.Windows)
	}
	want := map[string]int{"月度": 42, "Auto 模型": 18, "第三方 API": 27, "Grok Bot": 62}
	for _, window := range mapped.Windows {
		if expected, ok := want[window.Label]; !ok || expected != window.UsedPercent {
			t.Fatalf("unexpected window=%+v", window)
		}
	}
}
