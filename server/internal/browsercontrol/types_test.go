package browsercontrol

import (
	"encoding/json"
	"testing"
)

func TestURLAllowed(t *testing.T) {
	domains := []string{"example.com", "*.atolla.dev"}
	cases := []struct {
		url string
		ok  bool
	}{
		{"https://example.com/path", true},
		{"https://api.atolla.dev/path", true},
		{"https://atolla.dev/path", false},
		{"https://evil.example/path", false},
		{"javascript:alert(1)", false},
	}
	for _, tc := range cases {
		if got := URLAllowed(tc.url, domains); got != tc.ok {
			t.Errorf("URLAllowed(%q)=%v, want %v", tc.url, got, tc.ok)
		}
	}
}

func TestNormalizeTaskRejectsArbitraryJavaScriptAndBlockedDomain(t *testing.T) {
	_, err := NormalizeTask(TaskRequest{Action: "dom.read", Params: json.RawMessage(`{"script":"document.body"}`)}, nil)
	if err == nil {
		t.Fatal("expected arbitrary JavaScript to be rejected")
	}
	_, err = NormalizeTask(TaskRequest{Action: "tabs.open", Params: json.RawMessage(`{"url":"https://example.com"}`)}, nil)
	if err == nil {
		t.Fatal("expected blocked domain to be rejected")
	}
	req, err := NormalizeTask(TaskRequest{Action: "tabs.open", Params: json.RawMessage(`{"url":"http://127.0.0.1:8080"}`)}, nil)
	if err != nil || req.TaskID == "" || req.TimeoutMS != DefaultTimeoutMS {
		t.Fatalf("normalized task=%+v err=%v", req, err)
	}
}

func TestNormalizeChatGPTTask(t *testing.T) {
	req, err := NormalizeTask(TaskRequest{
		Action: "chatgpt.send_message",
		Params: json.RawMessage(`{"text":"请总结今天的任务"}`),
	}, []string{"chatgpt.com"})
	if err != nil {
		t.Fatal(err)
	}
	if req.TimeoutMS != ChatGPTTimeoutMS {
		t.Fatalf("timeout=%d, want %d", req.TimeoutMS, ChatGPTTimeoutMS)
	}
	shortReq, err := NormalizeTask(TaskRequest{
		Action: "chatgpt.send_message", TimeoutMS: 100,
		Params: json.RawMessage(`{"text":"你好"}`),
	}, []string{"chatgpt.com"})
	if err != nil || shortReq.TimeoutMS != ChatGPTMinTimeoutMS {
		t.Fatalf("short task=%+v err=%v", shortReq, err)
	}

	_, err = NormalizeTask(TaskRequest{Action: "chatgpt.send_message", Params: json.RawMessage(`{"text":"  "}`)}, nil)
	if err == nil {
		t.Fatal("expected empty ChatGPT message to be rejected")
	}
}
