package remotebridge

import (
	"fmt"
	"net"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
)

// HostMetrics is reported on heartbeat for the mobile instances UI.
type HostMetrics struct {
	OS        string  `json:"os"`
	IP        string  `json:"ip"`
	UptimeSec int64   `json:"uptime_sec"`
	CPUPct    float64 `json:"cpu_pct"`
	MemPct    float64 `json:"mem_pct"`
	DiskPct   float64 `json:"disk_pct"`
}

// CollectHostMetrics gathers OS / IP / uptime / CPU / memory / disk for relay heartbeat.
func CollectHostMetrics() HostMetrics {
	m := HostMetrics{
		OS: displayOS(),
		IP: primaryIPv4(),
	}
	if up, err := host.Uptime(); err == nil {
		m.UptimeSec = int64(up)
	}
	if pcts, err := cpu.Percent(200*time.Millisecond, false); err == nil && len(pcts) > 0 {
		m.CPUPct = clampPct(pcts[0])
	}
	if vm, err := mem.VirtualMemory(); err == nil {
		m.MemPct = clampPct(vm.UsedPercent)
	}
	if usage, err := disk.Usage("/"); err == nil {
		m.DiskPct = clampPct(usage.UsedPercent)
	}
	return m
}

func displayOS() string {
	switch runtime.GOOS {
	case "darwin":
		return "macOS"
	case "windows":
		return "Windows"
	case "linux":
		return "Linux"
	default:
		return runtime.GOOS
	}
}

func primaryIPv4() string {
	conn, err := net.DialTimeout("udp", "8.8.8.8:80", 800*time.Millisecond)
	if err == nil {
		defer conn.Close()
		if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok && addr.IP != nil {
			ip := addr.IP.To4()
			if ip != nil {
				return ip.String()
			}
		}
	}
	ifaces, err := net.Interfaces()
	if err != nil {
		return "—"
	}
	for _, iface := range ifaces {
		if (iface.Flags&net.FlagUp) == 0 || (iface.Flags&net.FlagLoopback) != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			ip = ip.To4()
			if ip == nil {
				continue
			}
			s := ip.String()
			if strings.HasPrefix(s, "169.254.") {
				continue
			}
			return s
		}
	}
	return "—"
}

func clampPct(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return float64(int(v*10+0.5)) / 10
}

// FormatUptimeChinese formats seconds as e.g. "2天 3小时".
func FormatUptimeChinese(sec int64) string {
	if sec < 60 {
		return fmt.Sprintf("%d秒", sec)
	}
	days := sec / 86400
	hours := (sec % 86400) / 3600
	mins := (sec % 3600) / 60
	if days > 0 {
		if hours > 0 {
			return fmt.Sprintf("%d天 %d小时", days, hours)
		}
		return fmt.Sprintf("%d天", days)
	}
	if hours > 0 {
		if mins > 0 {
			return fmt.Sprintf("%d小时 %d分", hours, mins)
		}
		return fmt.Sprintf("%d小时", hours)
	}
	return fmt.Sprintf("%d分", mins)
}
