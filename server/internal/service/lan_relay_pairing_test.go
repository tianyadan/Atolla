package service

import (
	"testing"
	"time"
)

func TestBuildLanRelayPairingPayloadIncludesInstanceID(t *testing.T) {
	payload := buildLanRelayPairingPayload("instance-office", "session", "challenge", []string{"http://192.168.1.8:7943"}, time.Unix(1_700_000_000, 0))
	if payload.InstanceID != "instance-office" {
		t.Fatalf("instance id=%q, want instance-office", payload.InstanceID)
	}
}
