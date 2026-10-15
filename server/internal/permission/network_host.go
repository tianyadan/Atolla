package permission

import (
	"net"
	"net/url"
	"regexp"
	"strings"
)

var urlInCommandRe = regexp.MustCompile(`(?i)https?://[^\s'"\\]+`)

// NetworkHostAction builds a session-grantable action keyed by hostname.
func NetworkHostAction(base ToolAction, host string) ToolAction {
	host = strings.ToLower(strings.TrimSpace(host))
	a := base
	a.ActionType = ActionNetworkRead
	a.ToolName = "NetworkHost"
	a.Command = host
	a.argv = []string{"NETWORK_HOST", host}
	a.Args = map[string]any{"host": host}
	return a
}

// IsNetworkToolAction reports whether this action needs domain allowlist checks.
func IsNetworkToolAction(a ToolAction) bool {
	if a.ActionType == ActionNetworkRead || a.ActionType == ActionNetworkWrite {
		return true
	}
	if a.ToolName == "WebFetch" || a.ToolName == "WebSearch" || a.ToolName == "Browser" {
		return true
	}
	if a.ToolName == "Bash" || a.ActionType == ActionShellExec {
		return ExtractNetworkHost(a) != ""
	}
	return false
}

// ExtractNetworkHost returns a hostname from URL args or curl/wget-style commands.
func ExtractNetworkHost(a ToolAction) string {
	if a.Args != nil {
		if u, _ := a.Args["url"].(string); strings.TrimSpace(u) != "" {
			if h := hostFromURL(u); h != "" {
				return h
			}
		}
	}
	if h := hostFromURL(a.Command); h != "" {
		return h
	}
	cmd := a.Command
	if cmd == "" && a.Args != nil {
		cmd, _ = a.Args["command"].(string)
	}
	if m := urlInCommandRe.FindString(cmd); m != "" {
		return hostFromURL(m)
	}
	return ""
}

func hostFromURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(u.Hostname()))
}

// HostMatchesAllowlist checks exact host or *.domain wildcards.
func HostMatchesAllowlist(host string, patterns []string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return false
	}
	for _, p := range patterns {
		p = strings.ToLower(strings.TrimSpace(p))
		if p == "" {
			continue
		}
		if p == host {
			return true
		}
		if strings.HasPrefix(p, "*.") {
			suf := strings.TrimPrefix(p, "*")
			if strings.HasSuffix(host, suf) || host == strings.TrimPrefix(p, "*.") {
				return true
			}
		}
	}
	return false
}

// NormalizeAllowlistPattern validates and normalizes a user/agent pattern.
// Rejects empty, private IPs, and link-local / metadata hosts.
func NormalizeAllowlistPattern(raw string) (string, error) {
	p := strings.ToLower(strings.TrimSpace(raw))
	p = strings.TrimPrefix(p, "https://")
	p = strings.TrimPrefix(p, "http://")
	p = strings.Split(p, "/")[0]
	p = strings.Split(p, ":")[0]
	p = strings.TrimSpace(p)
	if p == "" {
		return "", errPattern("empty pattern")
	}
	check := p
	if strings.HasPrefix(p, "*.") {
		check = strings.TrimPrefix(p, "*.")
		if check == "" || strings.Contains(check, "*") {
			return "", errPattern("invalid wildcard")
		}
	} else if strings.Contains(p, "*") {
		return "", errPattern("invalid wildcard")
	}
	if ip := net.ParseIP(check); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return "", errPattern("private or link-local IP not allowed")
		}
		if check == "169.254.169.254" {
			return "", errPattern("metadata IP not allowed")
		}
	}
	if check == "localhost" || strings.HasSuffix(check, ".local") {
		return "", errPattern("local hostnames not allowed")
	}
	return p, nil
}

type patternError string

func (e patternError) Error() string { return string(e) }

func errPattern(msg string) error { return patternError(msg) }
