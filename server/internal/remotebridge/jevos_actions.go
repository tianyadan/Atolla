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

// handleJevosSettingsInstall payload.package_id 必填，china_mirror 可选。
func handleJevosSettingsInstall(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("runtime not configured")
	}
	pkg := ""
	chinaMirror := false
	if ec.Payload != nil {
		pkg = strings.TrimSpace(fmt.Sprint(ec.Payload["package_id"]))
		if pkg == "<nil>" {
			pkg = ""
		}
		switch v := ec.Payload["china_mirror"].(type) {
		case bool:
			chinaMirror = v
		case string:
			chinaMirror = v == "1" || v == "true" || v == "yes"
		case float64:
			chinaMirror = v != 0
		}
	}
	if pkg == "" {
		return nil, fmt.Errorf("package_id required")
	}
	return ec.Runtime.JevosSettingsInstall(pkg, chinaMirror)
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

// handleJevosSettingsUninstall 卸载平台安装的 JEV。
func handleJevosSettingsUninstall(ec *ExecContext) (any, error) {
	if ec.Runtime == nil {
		return nil, fmt.Errorf("runtime not configured")
	}
	return ec.Runtime.JevosSettingsUninstall()
}
