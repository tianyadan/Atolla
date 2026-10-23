package remotebridge

import (
	"fmt"
	"strings"
)

// handleJevosSettingsGet payload.force=true|1 时强制重检。
func handleJevosSettingsGet(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("runtime not configured")
	}
	force := false
	if ec.Payload != nil {
		switch v := ec.Payload["force"].(type) {
		case bool:
			force = v
		case string:
			force = v == "1" || v == "true" || v == "yes"
		case float64:
			force = v != 0
		}
	}
	return ec.Runtime.JevosSettingsGet(force)
}

// handleJevosSettingsInstall payload.package_id 必填。
func handleJevosSettingsInstall(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("runtime not configured")
	}
	pkg := ""
	if ec.Payload != nil {
		pkg = strings.TrimSpace(fmt.Sprint(ec.Payload["package_id"]))
		if pkg == "<nil>" {
			pkg = ""
		}
	}
	if pkg == "" {
		return nil, fmt.Errorf("package_id required")
	}
	return ec.Runtime.JevosSettingsInstall(pkg)
}

// handleJevosSettingsSet payload.enabled 胶囊开关。
func handleJevosSettingsSet(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("runtime not configured")
	}
	enabled := false
	if ec.Payload != nil {
		switch v := ec.Payload["enabled"].(type) {
		case bool:
			enabled = v
		case string:
			enabled = v == "1" || v == "true" || v == "yes"
		case float64:
			enabled = v != 0
		}
	}
	return ec.Runtime.JevosSettingsSet(enabled)
}
