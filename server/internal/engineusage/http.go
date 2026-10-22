package engineusage

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const defaultHTTPTimeout = 20 * time.Second

var (
	httpClient      = newUsageHTTPClient()
	systemProxyOnce sync.Once
	systemProxyURL  *url.URL
)

// SetHTTPClient 仅供测试替换 HTTP 客户端。
func SetHTTPClient(c *http.Client) {
	if c == nil {
		httpClient = newUsageHTTPClient()
		return
	}
	httpClient = c
}

// newUsageHTTPClient 走环境代理；未设置时回退 macOS 系统 HTTPS 代理（如 Clash 7897）。
func newUsageHTTPClient() *http.Client {
	return &http.Client{
		Timeout: defaultHTTPTimeout,
		Transport: &http.Transport{
			Proxy:                 usageProxy,
			ProxyConnectHeader:    http.Header{"User-Agent": []string{"Atolla-EngineUsage"}},
			TLSHandshakeTimeout:   12 * time.Second,
			ResponseHeaderTimeout: 15 * time.Second,
			IdleConnTimeout:       30 * time.Second,
		},
	}
}

// usageProxy：优先 HTTPS_PROXY/HTTP_PROXY，否则读本机系统代理。
func usageProxy(req *http.Request) (*url.URL, error) {
	if u, err := http.ProxyFromEnvironment(req); err == nil && u != nil {
		return u, nil
	}
	if u := macSystemHTTPSProxy(); u != nil {
		return u, nil
	}
	return nil, nil
}

// macSystemHTTPSProxy 解析 macOS「系统设置 → 代理」（Clash / Surge 常见）。
func macSystemHTTPSProxy() *url.URL {
	if runtime.GOOS != "darwin" {
		return nil
	}
	systemProxyOnce.Do(func() {
		systemProxyURL = readMacHTTPSProxy()
	})
	return systemProxyURL
}

func readMacHTTPSProxy() *url.URL {
	// 允许用环境变量强制指定（给 launchd / 无 GUI 场景）。
	if raw := strings.TrimSpace(os.Getenv("ATOLLA_HTTPS_PROXY")); raw != "" {
		if u, err := url.Parse(raw); err == nil && u.Host != "" {
			return u
		}
	}
	out, err := exec.Command("scutil", "--proxy").Output()
	if err != nil {
		return nil
	}
	enable, host, port := false, "", 0
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "HTTPSEnable"):
			enable = strings.HasSuffix(line, ": 1")
		case strings.HasPrefix(line, "HTTPSProxy"):
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				host = strings.TrimSpace(parts[1])
			}
		case strings.HasPrefix(line, "HTTPSPort"):
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				port, _ = strconv.Atoi(strings.TrimSpace(parts[1]))
			}
		}
	}
	if !enable || host == "" || port <= 0 {
		return nil
	}
	u := &url.URL{Scheme: "http", Host: net.JoinHostPort(host, strconv.Itoa(port))}
	return u
}

func doGET(ctx context.Context, rawURL string, headers map[string]string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, 0, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, annotateDialError(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

// annotateDialError 给 connection refused 补上代理提示（直连 chatgpt.com 在国内常被拒）。
func annotateDialError(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	if strings.Contains(msg, "connection refused") || strings.Contains(msg, "i/o timeout") || strings.Contains(msg, "no such host") {
		return fmt.Errorf("%w（本机直连失败时请开启系统代理，或设置 HTTPS_PROXY / ATOLLA_HTTPS_PROXY）", err)
	}
	return err
}
