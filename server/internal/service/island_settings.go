package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	islandReleaseRepo  = "tianyadan/Atolla"
	islandLaunchLabel  = "com.atolla.island"
	islandUserAgent    = "Atolla-IslandInstaller/1.0"
)

// IslandSettingsStatus 设置页「灵动岛」状态（可缓存）。
type IslandSettingsStatus struct {
	Installed   bool   `json:"installed"`
	Enabled     bool   `json:"enabled"`
	HasSource   bool   `json:"has_source"`
	HasXcode    bool   `json:"has_xcode"`
	SourcePath  string `json:"source_path"`
	BinaryPath  string `json:"binary_path"`
	XcodeDetail string `json:"xcode_detail"`
	Detail      string `json:"detail"`
	Cached      bool   `json:"cached"`
	CheckedAt   string `json:"checked_at"`
	RepoHint    string `json:"repo_hint"`
	ReleaseTag  string `json:"release_tag,omitempty"`
	ReleaseURL  string `json:"release_url,omitempty"`
	AssetName   string `json:"asset_name,omitempty"`
}

type islandSettingsCacheFile struct {
	IslandSettingsStatus
}

type githubReleaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

type githubRelease struct {
	TagName string               `json:"tag_name"`
	HTMLURL string               `json:"html_url"`
	Assets  []githubReleaseAsset `json:"assets"`
}

// GetIslandSettingsStatus 读取灵动岛状态；默认用缓存，force 时重检。
func (s *Service) GetIslandSettingsStatus(force bool) (IslandSettingsStatus, error) {
	if !force {
		if c, ok := s.loadIslandSettingsCache(); ok {
			c.Cached = true
			return c, nil
		}
	}
	st := s.probeIslandSettings()
	st.Cached = false
	st.CheckedAt = time.Now().Format(time.RFC3339)
	_ = s.saveIslandSettingsCache(st)
	return st, nil
}

// InstallIsland 从 GitHub 最新灵动岛 Release 下载预编译包并自动安装（无需 Xcode）。
func (s *Service) InstallIsland() (IslandSettingsStatus, error) {
	if runtime.GOOS != "darwin" {
		st := s.probeIslandSettings()
		st.Detail = "灵动岛仅支持 macOS"
		return st, fmt.Errorf("%s", st.Detail)
	}

	rel, err := s.resolveIslandRelease()
	if err != nil {
		st := s.probeIslandSettings()
		st.Detail = shortIslandErr(err)
		return st, fmt.Errorf("%s", st.Detail)
	}

	tmp := filepath.Join(homeDir(), ".atolla", "tmp-island-"+fmt.Sprintf("%d", time.Now().Unix()))
	if err := os.MkdirAll(tmp, 0o755); err != nil {
		st := s.probeIslandSettings()
		st.Detail = "无法创建临时目录"
		return st, fmt.Errorf("%s", st.Detail)
	}
	defer func() {
		_ = os.Rename(tmp, tmp+".done."+fmt.Sprintf("%d", time.Now().Unix()))
	}()

	zipPath := filepath.Join(tmp, "island.zip")
	if err := s.fetchIslandZip(rel, zipPath); err != nil {
		st := s.probeIslandSettings()
		st.Detail = shortIslandErr(err)
		st.ReleaseTag = rel.TagName
		st.ReleaseURL = rel.HTMLURL
		return st, fmt.Errorf("%s", st.Detail)
	}

	extractDir := filepath.Join(tmp, "extract")
	if err := os.MkdirAll(extractDir, 0o755); err != nil {
		st := s.probeIslandSettings()
		st.Detail = "解压准备失败"
		return st, fmt.Errorf("%s", st.Detail)
	}
	if err := unzipTo(zipPath, extractDir); err != nil {
		st := s.probeIslandSettings()
		st.Detail = "解压失败: " + shortIslandErr(err)
		return st, fmt.Errorf("%s", st.Detail)
	}

	pkgRoot, err := findIslandPackageRoot(extractDir)
	if err != nil {
		st := s.probeIslandSettings()
		st.Detail = shortIslandErr(err)
		return st, fmt.Errorf("%s", st.Detail)
	}

	if err := s.installIslandFromPackage(pkgRoot); err != nil {
		st := s.probeIslandSettings()
		st.Detail = shortIslandErr(err)
		st.ReleaseTag = rel.TagName
		st.ReleaseURL = rel.HTMLURL
		return st, fmt.Errorf("%s", st.Detail)
	}

	if err := s.startIslandLaunchAgent(); err != nil {
		st := s.probeIslandSettings()
		st.Detail = "已写入文件，但启动失败: " + shortIslandErr(err)
		st.ReleaseTag = rel.TagName
		st.ReleaseURL = rel.HTMLURL
		_ = s.saveIslandSettingsCache(st)
		return st, fmt.Errorf("%s", st.Detail)
	}

	st := s.probeIslandSettings()
	st.Cached = false
	st.CheckedAt = time.Now().Format(time.RFC3339)
	st.ReleaseTag = rel.TagName
	st.ReleaseURL = rel.HTMLURL
	st.AssetName = rel.Assets[0].Name
	if st.Detail == "" || !st.Enabled {
		st.Detail = "安装成功（" + rel.TagName + "）"
	}
	if _, err := os.Stat(s.islandConfigPath()); err != nil {
		st.Detail += "；请登录一次以同步凭证"
	}
	_ = s.saveIslandSettingsCache(st)
	return st, nil
}

// UninstallIsland 停止常驻并清理本机安装产物（不留冗余）。
func (s *Service) UninstallIsland() (IslandSettingsStatus, error) {
	_ = s.stopIslandLaunchAgent()
	binDir := s.islandBinDir()
	bin := filepath.Join(binDir, "AtollaIsland")
	_ = exec.Command("pkill", "-f", bin).Run()

	// 清理安装目录内容：二进制 / bundle / 精灵图
	for _, name := range []string{
		"AtollaIsland",
		"AtollaIsland_AtollaIsland.bundle",
		"jelly-sprites",
	} {
		p := filepath.Join(binDir, name)
		if err := os.RemoveAll(p); err != nil {
			st := s.probeIslandSettings()
			st.Detail = "清理失败: " + shortIslandErr(err)
			return st, fmt.Errorf("%s", st.Detail)
		}
	}

	// 缓存与日志归档后删除缓存文件
	_ = os.Remove(s.islandSettingsCachePath())
	for _, logName := range []string{"island.out.log", "island.err.log"} {
		_ = os.Remove(filepath.Join(homeDir(), ".atolla", logName))
	}

	st := s.probeIslandSettings()
	st.Detail = "已卸载灵动岛"
	st.Cached = false
	st.CheckedAt = time.Now().Format(time.RFC3339)
	_ = s.saveIslandSettingsCache(st)
	return st, nil
}

// SetIslandEnabled 启用/关闭 LaunchAgent；开启时若未安装则自动从 GitHub 安装。
func (s *Service) SetIslandEnabled(enabled bool) (IslandSettingsStatus, error) {
	if runtime.GOOS != "darwin" {
		st := s.probeIslandSettings()
		st.Detail = "灵动岛仅支持 macOS"
		return st, fmt.Errorf("%s", st.Detail)
	}
	if enabled {
		bin := filepath.Join(s.islandBinDir(), "AtollaIsland")
		if !fileExists(bin) {
			return s.InstallIsland()
		}
		if err := s.startIslandLaunchAgent(); err != nil {
			st := s.probeIslandSettings()
			st.Detail = shortIslandErr(err)
			return st, fmt.Errorf("%s", st.Detail)
		}
	} else {
		if err := s.stopIslandLaunchAgent(); err != nil {
			st := s.probeIslandSettings()
			st.Detail = shortIslandErr(err)
			return st, fmt.Errorf("%s", st.Detail)
		}
	}
	st := s.probeIslandSettings()
	st.Cached = false
	st.CheckedAt = time.Now().Format(time.RFC3339)
	_ = s.saveIslandSettingsCache(st)
	return st, nil
}

func (s *Service) probeIslandSettings() IslandSettingsStatus {
	bin := filepath.Join(s.islandBinDir(), "AtollaIsland")
	st := IslandSettingsStatus{
		RepoHint:   "github.com/" + islandReleaseRepo + " releases",
		BinaryPath: bin,
	}
	st.Installed = fileExists(bin)
	st.Enabled = s.islandLaunchAgentLoaded()
	// 源码/Xcode 仅作附加信息，不再作为安装前置条件
	if root, err := s.resolveIslandRoot(); err == nil {
		st.HasSource = true
		st.SourcePath = root
	}
	for _, d := range []string{
		"/Applications/Xcode.app/Contents/Developer",
		"/Users/tianhaowen/Desktop/Xcode.app/Contents/Developer",
	} {
		if info, err := os.Stat(d); err == nil && info.IsDir() {
			st.HasXcode = true
			st.XcodeDetail = d
			break
		}
	}
	switch {
	case st.Installed && st.Enabled:
		st.Detail = "已安装并启用"
	case st.Installed && !st.Enabled:
		st.Detail = "已安装，胶囊关闭"
	default:
		st.Detail = "未安装：点击安装将自动下载最新 GitHub Release"
	}
	return st
}

func (s *Service) islandBinDir() string {
	return filepath.Join(homeDir(), ".atolla", "bin")
}

func (s *Service) islandPlistPath() string {
	return filepath.Join(homeDir(), "Library", "LaunchAgents", islandLaunchLabel+".plist")
}

func (s *Service) islandLaunchAgentLoaded() bool {
	if runtime.GOOS != "darwin" {
		return false
	}
	uid := os.Getuid()
	out, err := exec.Command("launchctl", "print", fmt.Sprintf("gui/%d/%s", uid, islandLaunchLabel)).CombinedOutput()
	if err == nil && len(out) > 0 {
		return true
	}
	return false
}

func (s *Service) startIslandLaunchAgent() error {
	bin := filepath.Join(s.islandBinDir(), "AtollaIsland")
	if !fileExists(bin) {
		return fmt.Errorf("未找到二进制")
	}
	_ = os.Chmod(bin, 0o755)
	_ = exec.Command("xattr", "-cr", bin).Run()
	bundle := filepath.Join(s.islandBinDir(), "AtollaIsland_AtollaIsland.bundle")
	if dirExists(bundle) {
		_ = exec.Command("xattr", "-cr", bundle).Run()
	}

	plist := s.islandPlistPath()
	if err := os.MkdirAll(filepath.Dir(plist), 0o755); err != nil {
		return err
	}
	body := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>%s</string>
  <key>ProgramArguments</key>
  <array>
    <string>%s</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>%s</string>
  <key>StandardErrorPath</key>
  <string>%s</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
`, islandLaunchLabel, bin,
		filepath.Join(homeDir(), ".atolla", "island.out.log"),
		filepath.Join(homeDir(), ".atolla", "island.err.log"),
	)
	if err := os.WriteFile(plist, []byte(body), 0o644); err != nil {
		return err
	}

	uid := os.Getuid()
	domain := fmt.Sprintf("gui/%d", uid)
	_ = exec.Command("pkill", "-f", bin).Run()
	_ = exec.Command("launchctl", "bootout", domain+"/"+islandLaunchLabel).Run()
	if out, err := exec.Command("launchctl", "bootstrap", domain, plist).CombinedOutput(); err != nil {
		if out2, err2 := exec.Command("launchctl", "load", plist).CombinedOutput(); err2 != nil {
			return fmt.Errorf("启动失败: %s", shortIslandErr(fmt.Errorf("%v %s | %v %s", err, string(out), err2, string(out2))))
		}
	}
	_ = exec.Command("launchctl", "enable", domain+"/"+islandLaunchLabel).Run()
	_ = exec.Command("launchctl", "kickstart", "-k", domain+"/"+islandLaunchLabel).Run()

	// 短暂等待确认进程起来
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if exec.Command("pgrep", "-f", bin).Run() == nil {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	// 读错误日志给一句提示
	if raw, err := os.ReadFile(filepath.Join(homeDir(), ".atolla", "island.err.log")); err == nil {
		if msg := shortIslandErr(fmt.Errorf("%s", string(raw))); msg != "" && msg != "未知错误" {
			return fmt.Errorf("%s", msg)
		}
	}
	return fmt.Errorf("进程未启动，请查看 ~/.atolla/island.err.log")
}

func (s *Service) stopIslandLaunchAgent() error {
	if runtime.GOOS != "darwin" {
		return nil
	}
	uid := os.Getuid()
	domain := fmt.Sprintf("gui/%d", uid)
	_ = exec.Command("launchctl", "bootout", domain+"/"+islandLaunchLabel).Run()
	bin := filepath.Join(s.islandBinDir(), "AtollaIsland")
	_ = exec.Command("pkill", "-f", bin).Run()
	plist := s.islandPlistPath()
	if fileExists(plist) {
		stamp := time.Now().Format("20060102150405")
		_ = os.Rename(plist, plist+".off."+stamp)
	}
	return nil
}

// resolveIslandRelease 取含本机架构 zip 的最新包。
// 顺序：GitHub API（可带 Token）→ gh CLI → 本机 dist 回退，避免未认证 API 限流直接失败。
func (s *Service) resolveIslandRelease() (githubRelease, error) {
	wantPrefix := "AtollaIsland-macos-" + islandArchToken() + "-"
	var errs []string

	if rel, err := s.pickIslandReleaseFromList(func() ([]githubRelease, error) {
		return s.fetchIslandReleasesAPI()
	}, wantPrefix); err == nil {
		return rel, nil
	} else {
		errs = append(errs, "API: "+shortIslandErr(err))
	}

	if rel, err := s.pickIslandReleaseFromList(func() ([]githubRelease, error) {
		return s.fetchIslandReleasesViaGh()
	}, wantPrefix); err == nil {
		return rel, nil
	} else if !strings.Contains(err.Error(), "gh 不可用") {
		errs = append(errs, "gh: "+shortIslandErr(err))
	}

	if rel, err := s.resolveIslandReleaseFromLocalDist(wantPrefix); err == nil {
		return rel, nil
	} else {
		errs = append(errs, "本地: "+shortIslandErr(err))
	}

	msg := "无法获取灵动岛安装包"
	if len(errs) > 0 {
		msg += "（" + strings.Join(errs, "；") + "）"
	}
	return githubRelease{}, fmt.Errorf("%s", msg)
}

func (s *Service) pickIslandReleaseFromList(load func() ([]githubRelease, error), wantPrefix string) (githubRelease, error) {
	releases, err := load()
	if err != nil {
		return githubRelease{}, err
	}
	var fallback githubRelease
	for _, rel := range releases {
		asset, ok := pickIslandAsset(rel.Assets, wantPrefix)
		if !ok {
			continue
		}
		picked := githubRelease{
			TagName: rel.TagName,
			HTMLURL: rel.HTMLURL,
			Assets:  []githubReleaseAsset{asset},
		}
		if strings.HasPrefix(rel.TagName, "atolla-island-") {
			return picked, nil
		}
		if fallback.TagName == "" {
			fallback = picked
		}
	}
	if fallback.TagName != "" {
		return fallback, nil
	}
	return githubRelease{}, fmt.Errorf("未找到 %s 预编译包", wantPrefix)
}

func (s *Service) fetchIslandReleasesAPI() ([]githubRelease, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	url := "https://api.github.com/repos/" + islandReleaseRepo + "/releases?per_page=15"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", islandUserAgent)
	// 有 Token 时可大幅提高限额（设置页安装频繁时很关键）
	if tok := strings.TrimSpace(firstNonEmpty(os.Getenv("GITHUB_TOKEN"), os.Getenv("GH_TOKEN"))); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("无法连接 GitHub: %s", shortIslandErr(err))
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		low := strings.ToLower(string(body))
		if resp.StatusCode == 403 && (strings.Contains(low, "rate limit") || strings.Contains(string(body), "API rate limit")) {
			return nil, fmt.Errorf("GitHub API 限流，请稍后重试或配置 GITHUB_TOKEN")
		}
		return nil, fmt.Errorf("GitHub API %d", resp.StatusCode)
	}
	var list []githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return nil, fmt.Errorf("解析 Release 失败")
	}
	if len(list) == 0 {
		return nil, fmt.Errorf("仓库暂无 Release")
	}
	return list, nil
}

/** 本机已登录 gh 时走认证 API，规避未登录 60 次/小时限流 */
func (s *Service) fetchIslandReleasesViaGh() ([]githubRelease, error) {
	gh, err := exec.LookPath("gh")
	if err != nil {
		return nil, fmt.Errorf("gh 不可用")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, gh, "api", "repos/"+islandReleaseRepo+"/releases?per_page=15")
	cmd.Env = append(os.Environ(), "GH_PROMPT_DISABLED=1", "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return nil, fmt.Errorf("%s", shortIslandErr(fmt.Errorf("%s", msg)))
	}
	var list []githubRelease
	if err := json.Unmarshal(out, &list); err != nil {
		return nil, fmt.Errorf("gh 返回无法解析")
	}
	if len(list) == 0 {
		return nil, fmt.Errorf("仓库暂无 Release")
	}
	return list, nil
}

/** 网络失败时用仓库 dist 里最新 zip（开发机 / 已打过包的环境） */
func (s *Service) resolveIslandReleaseFromLocalDist(wantPrefix string) (githubRelease, error) {
	root, err := s.resolveIslandRoot()
	if err != nil {
		return githubRelease{}, fmt.Errorf("无本地 dist")
	}
	dist := filepath.Join(root, "dist")
	entries, err := os.ReadDir(dist)
	if err != nil {
		return githubRelease{}, fmt.Errorf("无本地 dist")
	}
	var bestName string
	var bestMod time.Time
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasPrefix(name, wantPrefix) || !strings.HasSuffix(strings.ToLower(name), ".zip") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if bestName == "" || info.ModTime().After(bestMod) {
			bestName = name
			bestMod = info.ModTime()
		}
	}
	if bestName == "" {
		return githubRelease{}, fmt.Errorf("dist 中无匹配 zip")
	}
	full := filepath.Join(dist, bestName)
	tag := strings.TrimSuffix(bestName, ".zip")
	return githubRelease{
		TagName: "local/" + tag,
		HTMLURL: full,
		Assets: []githubReleaseAsset{{
			Name:               bestName,
			BrowserDownloadURL: "file://" + full,
		}},
	}, nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

/** 拉取安装包：file → gh release download → HTTP（含超时友好提示）→ 本地 dist */
func (s *Service) fetchIslandZip(rel githubRelease, dest string) error {
	if len(rel.Assets) == 0 {
		return fmt.Errorf("Release 无资产")
	}
	asset := rel.Assets[0]
	url := asset.BrowserDownloadURL

	if strings.HasPrefix(url, "file://") {
		src := strings.TrimPrefix(url, "file://")
		if err := copyFile(src, dest, 0o644); err != nil {
			return fmt.Errorf("读取本地安装包失败")
		}
		return nil
	}

	var errs []string
	// 1) 已登录 gh：走认证下载，比直连 github.com/releases/download 更稳
	if !strings.HasPrefix(rel.TagName, "local/") {
		if err := s.downloadIslandZipViaGh(rel.TagName, asset.Name, dest); err == nil {
			return nil
		} else if !strings.Contains(err.Error(), "gh 不可用") {
			errs = append(errs, shortIslandErr(err))
		}
	}

	// 2) HTTP 直连（短超时，避免长时间卡住）
	if err := downloadFileWithTimeout(url, dest, 45*time.Second); err == nil {
		return nil
	} else {
		errs = append(errs, humanizeDownloadErr(err))
	}

	// 3) 回退本机 dist
	wantPrefix := "AtollaIsland-macos-" + islandArchToken() + "-"
	if local, err := s.resolveIslandReleaseFromLocalDist(wantPrefix); err == nil {
		src := strings.TrimPrefix(local.Assets[0].BrowserDownloadURL, "file://")
		if err := copyFile(src, dest, 0o644); err == nil {
			return nil
		}
		errs = append(errs, "本地包复制失败")
	}

	msg := "下载失败（网络无法访问 github.com）"
	if len(errs) > 0 {
		msg += "：" + errs[0]
	}
	return fmt.Errorf("%s", msg)
}

func (s *Service) downloadIslandZipViaGh(tag, assetName, dest string) error {
	gh, err := exec.LookPath("gh")
	if err != nil {
		return fmt.Errorf("gh 不可用")
	}
	dir := filepath.Dir(dest)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	// 下到临时目录再拷到 dest，避免 gh 改名规则不确定
	stage := filepath.Join(dir, "gh-dl")
	_ = os.MkdirAll(stage, 0o755)
	args := []string{
		"release", "download", tag,
		"--repo", islandReleaseRepo,
		"--pattern", assetName,
		"--dir", stage,
		"--clobber",
	}
	cmd := exec.CommandContext(ctx, gh, args...)
	cmd.Env = append(os.Environ(), "GH_PROMPT_DISABLED=1", "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("gh 下载失败: %s", shortIslandErr(fmt.Errorf("%s", msg)))
	}
	got := filepath.Join(stage, assetName)
	if !fileExists(got) {
		// 有时 pattern 命中后文件名仍如此；否则取目录内首个 zip
		entries, _ := os.ReadDir(stage)
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".zip") {
				got = filepath.Join(stage, e.Name())
				break
			}
		}
	}
	if !fileExists(got) {
		return fmt.Errorf("gh 下载后未找到 zip")
	}
	return copyFile(got, dest, 0o644)
}

func downloadFileWithTimeout(url, dest string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", islandUserAgent)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}

func humanizeDownloadErr(err error) string {
	if err == nil {
		return ""
	}
	s := strings.ToLower(err.Error())
	switch {
	case strings.Contains(s, "timeout") || strings.Contains(s, "deadline exceeded"):
		return "连接超时"
	case strings.Contains(s, "connection reset") || strings.Contains(s, "connection refused"):
		return "连接被重置"
	case strings.Contains(s, "no such host") || strings.Contains(s, "dns"):
		return "DNS 解析失败"
	default:
		return "网络不可达"
	}
}

func pickIslandAsset(assets []githubReleaseAsset, wantPrefix string) (githubReleaseAsset, bool) {
	for _, a := range assets {
		name := a.Name
		if strings.HasPrefix(name, wantPrefix) && strings.HasSuffix(strings.ToLower(name), ".zip") {
			return a, true
		}
	}
	return githubReleaseAsset{}, false
}

func islandArchToken() string {
	switch runtime.GOARCH {
	case "arm64":
		return "arm64"
	case "amd64":
		return "x86_64"
	default:
		return runtime.GOARCH
	}
}

func findIslandPackageRoot(extractDir string) (string, error) {
	var found string
	_ = filepath.WalkDir(extractDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if d.Name() == "AtollaIsland" {
			found = filepath.Dir(path)
			return fs.SkipAll
		}
		return nil
	})
	if found == "" {
		return "", fmt.Errorf("压缩包内缺少 AtollaIsland 二进制")
	}
	bundle := filepath.Join(found, "AtollaIsland_AtollaIsland.bundle")
	if !dirExists(bundle) {
		return "", fmt.Errorf("压缩包缺少 AtollaIsland_AtollaIsland.bundle")
	}
	return found, nil
}

func (s *Service) installIslandFromPackage(pkgRoot string) error {
	binDir := s.islandBinDir()
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return err
	}
	srcBin := filepath.Join(pkgRoot, "AtollaIsland")
	dstBin := filepath.Join(binDir, "AtollaIsland")
	if err := copyFile(srcBin, dstBin, 0o755); err != nil {
		return fmt.Errorf("写入二进制失败")
	}
	_ = os.Chmod(dstBin, 0o755)
	_ = exec.Command("xattr", "-cr", dstBin).Run()

	srcBundle := filepath.Join(pkgRoot, "AtollaIsland_AtollaIsland.bundle")
	dstBundle := filepath.Join(binDir, "AtollaIsland_AtollaIsland.bundle")
	if dirExists(dstBundle) {
		stamp := time.Now().Format("20060102150405")
		_ = os.Rename(dstBundle, dstBundle+".bak."+stamp)
	}
	if err := copyDirRecursive(srcBundle, dstBundle); err != nil {
		return fmt.Errorf("写入资源包失败")
	}
	_ = exec.Command("xattr", "-cr", dstBundle).Run()

	srcSprites := filepath.Join(pkgRoot, "jelly-sprites")
	if dirExists(srcSprites) {
		dstSprites := filepath.Join(binDir, "jelly-sprites")
		if dirExists(dstSprites) {
			stamp := time.Now().Format("20060102150405")
			_ = os.Rename(dstSprites, dstSprites+".bak."+stamp)
		}
		if err := copyDirRecursive(srcSprites, dstSprites); err != nil {
			return fmt.Errorf("写入精灵图失败")
		}
	}
	_ = exec.Command("xattr", "-cr", pkgRoot).Run()
	return nil
}

func dirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

/** 设置页展示用：压成约 1 行短错误 */
func shortIslandErr(err error) string {
	if err == nil {
		return "未知错误"
	}
	s := strings.TrimSpace(err.Error())
	s = strings.ReplaceAll(s, "\r", "\n")
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	// 常见长前缀裁掉
	for _, p := range []string{"Fatal error: ", "错误: ", "error: "} {
		s = strings.TrimPrefix(s, p)
	}
	const max = 120
	if len([]rune(s)) > max {
		r := []rune(s)
		s = string(r[:max]) + "…"
	}
	if s == "" {
		return "未知错误"
	}
	return s
}

func (s *Service) runIslandScript(script string, args []string, timeout time.Duration) (string, error) {
	return s.runIslandScriptEnv(script, args, timeout, nil)
}

func (s *Service) runIslandScriptEnv(script string, args []string, timeout time.Duration, extraEnv []string) (string, error) {
	_ = os.Chmod(script, 0o755)
	cmd := exec.Command(script, args...)
	if root, err := s.resolveIslandRoot(); err == nil {
		cmd.Dir = root
	}
	path := "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:" + os.Getenv("PATH")
	env := append(os.Environ(), "PATH="+path, "GIT_TERMINAL_PROMPT=0")
	env = append(env, extraEnv...)
	cmd.Env = env
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	done := make(chan error, 1)
	go func() { done <- cmd.Run() }()
	select {
	case err := <-done:
		return buf.String(), err
	case <-time.After(timeout):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		return buf.String(), fmt.Errorf("island script timeout")
	}
}

func (s *Service) resolveIslandRoot() (string, error) {
	script, err := s.resolveIslandScript("Package.swift")
	if err != nil {
		return "", err
	}
	return filepath.Dir(script), nil
}

func (s *Service) resolveIslandScript(rel string) (string, error) {
	rel = filepath.Clean(rel)
	root := strings.TrimSpace(s.Cfg.WorkspaceRoot)
	candidates := []string{}
	if root != "" {
		candidates = append(candidates,
			filepath.Join(root, "colleague-avatar", "macos", "AtollaIsland", rel),
			filepath.Join(root, "macos", "AtollaIsland", rel),
		)
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(wd, "macos", "AtollaIsland", rel),
			filepath.Join(wd, "..", "macos", "AtollaIsland", rel),
			filepath.Join(wd, "..", "..", "macos", "AtollaIsland", rel),
			filepath.Join(wd, "colleague-avatar", "macos", "AtollaIsland", rel),
		)
	}
	// 常见本机仓库路径
	candidates = append(candidates,
		filepath.Join("/Users/tianhaowen/Desktop/code/atolla/macos/AtollaIsland", rel),
	)
	for _, p := range candidates {
		p = filepath.Clean(p)
		st, err := os.Stat(p)
		if err != nil || st.IsDir() {
			continue
		}
		return p, nil
	}
	return "", fmt.Errorf("island path not found: %s", rel)
}

func (s *Service) islandSettingsCachePath() string {
	return filepath.Join(homeDir(), ".atolla", "island-settings-cache.json")
}

func (s *Service) loadIslandSettingsCache() (IslandSettingsStatus, bool) {
	raw, err := os.ReadFile(s.islandSettingsCachePath())
	if err != nil {
		return IslandSettingsStatus{}, false
	}
	var c islandSettingsCacheFile
	if err := json.Unmarshal(raw, &c); err != nil {
		return IslandSettingsStatus{}, false
	}
	if c.CheckedAt == "" {
		return IslandSettingsStatus{}, false
	}
	return c.IslandSettingsStatus, true
}

func (s *Service) saveIslandSettingsCache(st IslandSettingsStatus) error {
	path := s.islandSettingsCachePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	st.Cached = true
	if st.CheckedAt == "" {
		st.CheckedAt = time.Now().Format(time.RFC3339)
	}
	raw, err := json.MarshalIndent(islandSettingsCacheFile{IslandSettingsStatus: st}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func homeDir() string {
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return h
	}
	return os.TempDir()
}
