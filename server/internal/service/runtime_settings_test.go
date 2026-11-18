package service

import "testing"

func TestValidateRuntimeSettings(t *testing.T) {
	valid := []RuntimeSettings{
		{IdleTTLSeconds: 0, MemoryLimitMB: 128},
		{IdleTTLSeconds: 60, MemoryLimitMB: 2048},
		{IdleTTLSeconds: 3600, MemoryLimitMB: 32768},
	}
	for _, item := range valid {
		if err := validateRuntimeSettings(item); err != nil {
			t.Fatalf("valid settings %+v: %v", item, err)
		}
	}
	invalid := []RuntimeSettings{
		{IdleTTLSeconds: -1, MemoryLimitMB: 2048},
		{IdleTTLSeconds: 3601, MemoryLimitMB: 2048},
		{IdleTTLSeconds: 60, MemoryLimitMB: 127},
		{IdleTTLSeconds: 60, MemoryLimitMB: 32769},
	}
	for _, item := range invalid {
		if err := validateRuntimeSettings(item); err == nil {
			t.Fatalf("expected invalid settings: %+v", item)
		}
	}
}
