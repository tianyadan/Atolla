package remotebridge

import (
	"testing"

	"github.com/shirou/gopsutil/v4/sensors"
)

func TestPickHostTempC_PreferCPULike(t *testing.T) {
	got, ok := pickHostTempC([]sensors.TemperatureStat{
		{SensorKey: "NAND CH0 temp", Temperature: 37.0},
		{SensorKey: "PMU tdie3", Temperature: 41.6},
		{SensorKey: "PMU tdev4", Temperature: -9201.1},
		{SensorKey: "gas gauge battery", Temperature: 32.5},
	})
	if !ok {
		t.Fatal("expected ok")
	}
	if got != 41.6 {
		t.Fatalf("got %v want 41.6", got)
	}
}

func TestPickHostTempC_FallbackMaxValid(t *testing.T) {
	got, ok := pickHostTempC([]sensors.TemperatureStat{
		{SensorKey: "ambient", Temperature: 28.4},
		{SensorKey: "battery", Temperature: 33.1},
		{SensorKey: "bad", Temperature: 0},
	})
	if !ok {
		t.Fatal("expected ok")
	}
	if got != 33.1 {
		t.Fatalf("got %v want 33.1", got)
	}
}

func TestPickHostTempC_None(t *testing.T) {
	_, ok := pickHostTempC([]sensors.TemperatureStat{
		{SensorKey: "x", Temperature: -1},
		{SensorKey: "y", Temperature: 200},
	})
	if ok {
		t.Fatal("expected no reading")
	}
}

func TestCollectHostMetrics_TempPresentOnDarwin(t *testing.T) {
	m := CollectHostMetrics()
	if m.TempC == nil {
		t.Log("temp_c unavailable on this host (acceptable)")
		return
	}
	if *m.TempC < 5 || *m.TempC > 120 {
		t.Fatalf("temp out of range: %v", *m.TempC)
	}
	t.Logf("temp_c=%.1f", *m.TempC)
}
