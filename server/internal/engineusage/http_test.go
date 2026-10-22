package engineusage

import (
	"errors"
	"strings"
	"testing"
)

func TestAnnotateDialErrorHintsProxy(t *testing.T) {
	err := annotateDialError(errors.New(`Get "https://chatgpt.com/x": dial tcp 1.2.3.4:443: connect: connection refused`))
	if err == nil || !strings.Contains(err.Error(), "HTTPS_PROXY") {
		t.Fatalf("want proxy hint, got %v", err)
	}
}

func TestReadMacHTTPSProxyFromScutilShape(t *testing.T) {
	// 仅校验 JoinHostPort 形态；真实 scutil 依赖本机。
	u := readMacHTTPSProxy()
	if u == nil {
		t.Skip("no macOS HTTPS system proxy enabled")
	}
	if u.Host == "" || u.Scheme == "" {
		t.Fatalf("bad proxy url %#v", u)
	}
}
