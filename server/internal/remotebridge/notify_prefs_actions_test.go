package remotebridge

import "testing"

func TestPayloadBool(t *testing.T) {
	v, ok := payloadBool(map[string]interface{}{"task_done": false}, "task_done")
	if !ok || v {
		t.Fatal("want false")
	}
	if _, ok := payloadBool(map[string]interface{}{"task_done": "1"}, "task_done"); ok {
		t.Fatal("string is not bool")
	}
	if _, ok := payloadBool(map[string]interface{}{}, "permission"); ok {
		t.Fatal("missing")
	}
}
