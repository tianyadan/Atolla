package service

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	jevosReleaseRepo    = "feder-cr/jev"
	jevosReleaseTag     = "jevos-v5" // 默认；可被 GitHub latest 覆盖
	jevosLaunchLabel    = "com.atolla.jevos"
	jevosModelAsset     = "jevos-v5-openvino-int8.zip"
	jevosInstallTimeout = 30 * time.Minute
	jevosSourceTimeout  = 12 * time.Minute
)

// JevosPackage 可下载安装包（运行时 + 模型）。
type JevosPackage struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	RuntimeURL  string `json:"runtime_url"`
	ModelURL    string `json:"model_url"`
	Recommended bool   `json:"recommended"`
	SizeHint    string `json:"size_hint"`
}

// JevosSettingsStatus 设置页 JEV 状态。
type JevosSettingsStatus struct {
	Installed    bool           `json:"installed"`
	Enabled      bool           `json:"enabled"`
	Healthy      bool           `json:"healthy"`
	Detail       string         `json:"detail"`
	BinaryPath   string         `json:"binary_path"`
	InstallDir   string         `json:"install_dir"`
	ReleaseTag   string         `json:"release_tag"`
	ReleaseURL   string         `json:"release_url"`
	HealthURL    string         `json:"health_url"`
	Packages     []JevosPackage `json:"packages"`
	Cached       bool           `json:"cached"`
	CheckedAt    string         `json:"checked_at"`
	ModelReady   bool           `json:"model_ready"`
	LaunchAgent  bool           `json:"launch_agent"`
	CanUninstall bool           `json:"can_uninstall"` // 平台安装目录存在时可卸载
}

type jevosSettingsFile struct {
	Enabled   bool   `json:"enabled"`
	PackageID string `json:"package_id,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

// JevosSettingsGet implements remotebridge.AgentRuntime。
func (s *Service) JevosSettingsGet(force bool) (any, error) {
	return s.GetJevosSettingsStatus(force)
}

// JevosSettingsInstall implements remotebridge.AgentRuntime。
func (s *Service) JevosSettingsInstall(packageID string, chinaMirror bool) (any, error) {
	st, err := s.InstallJevos(packageID, chinaMirror)
	return st, err
}

// JevosSettingsSet implements remotebridge.AgentRuntime。
func (s *Service) JevosSettingsSet(enabled bool) (any, error) {
	st, err := s.SetJevosEnabled(enabled)
	return st, err
}

// JevosSettingsUninstall implements remotebridge.AgentRuntime。
func (s *Service) JevosSettingsUninstall() (any, error) {
	st, err := s.UninstallJevos()
	return st, err
}

// GetJevosSettingsStatus 读取 JEV 状态；force 时重检。
func (s *Service) GetJevosSettingsStatus(force bool) (JevosSettingsStatus, error) {
	// Release 的模型压缩包可能自带 model/ 前缀。先修复已安装的旧目录，
	// 否则缓存会持续把“文件已下载但层级不对”展示成未安装。
	normalized, err := flattenJevosModelDirectory(filepath.Join(s.jevosInstallDir(), "model"))
	if err != nil {
		st := s.probeJevosSettings()
		st.Detail = "模型目录修复失败: " + err.Error()
		return st, err
	}
	if normalized {
		force = true
	}
	if !force {
		if c, ok := s.loadJevosSettingsCache(); ok {
			c.Cached = true
			return c, nil
		}
	}
	st := s.probeJevosSettings()
	st.Cached = false
	st.CheckedAt = time.Now().Format(time.RFC3339)
	_ = s.saveJevosSettingsCache(st)
	return st, nil
}

// InstallJevos 从 GitHub Release 下载并安装所选包。
func (s *Service) InstallJevos(packageID string, chinaMirror bool) (JevosSettingsStatus, error) {
	pkgs := s.jevosPackageCatalog(jevosReleaseTag)
	var pkg *JevosPackage
	for i := range pkgs {
		if pkgs[i].ID == packageID {
			pkg = &pkgs[i]
			break
		}
	}
	if pkg == nil {
		st := s.probeJevosSettings()
		st.Detail = "未知安装包: " + packageID
		return st, fmt.Errorf("%s", st.Detail)
	}

	dir := s.jevosInstallDir()
	tmp := filepath.Join(homeDir(), ".atolla", "tmp-jevos-"+fmt.Sprintf("%d", time.Now().Unix()))
	if err := os.MkdirAll(tmp, 0o755); err != nil {
		return s.probeJevosSettings(), err
	}
	defer func() {
		// 不用 rm：归档到 .off 时间戳目录
		_ = os.Rename(tmp, tmp+".done."+fmt.Sprintf("%d", time.Now().Unix()))
	}()

	runtimePath := filepath.Join(tmp, "runtime"+filepath.Ext(pkg.RuntimeURL))
	if strings.HasSuffix(pkg.RuntimeURL, ".tar.gz") {
		runtimePath = filepath.Join(tmp, "runtime.tar.gz")
	}
	modelPath := filepath.Join(tmp, "model.zip")

	// 整次安装设置硬上限，避免某个下载源无响应时界面永久卡住。
	installCtx, cancelInstall := context.WithTimeout(context.Background(), jevosInstallTimeout)
	defer cancelInstall()
	if err := downloadJevosReleaseAsset(installCtx, pkg.RuntimeURL, runtimePath, chinaMirror); err != nil {
		st := s.probeJevosSettings()
		st.Detail = "下载运行时失败: " + err.Error()
		return st, fmt.Errorf("%s", st.Detail)
	}
	if err := downloadJevosReleaseAsset(installCtx, pkg.ModelURL, modelPath, chinaMirror); err != nil {
		st := s.probeJevosSettings()
		st.Detail = "下载模型失败: " + err.Error()
		return st, fmt.Errorf("%s", st.Detail)
	}

	// 装到新目录再替换（避免半截覆盖）
	stage := dir + ".staging." + fmt.Sprintf("%d", time.Now().Unix())
	if err := os.MkdirAll(stage, 0o755); err != nil {
		return s.probeJevosSettings(), err
	}
	if strings.HasSuffix(runtimePath, ".zip") {
		if err := unzipTo(runtimePath, stage); err != nil {
			st := s.probeJevosSettings()
			st.Detail = "解压运行时失败: " + err.Error()
			return st, fmt.Errorf("%s", st.Detail)
		}
	} else {
		if err := untarGzTo(runtimePath, stage); err != nil {
			st := s.probeJevosSettings()
			st.Detail = "解压运行时失败: " + err.Error()
			return st, fmt.Errorf("%s", st.Detail)
		}
	}
	// release 包顶层常为 jev/，摊平到 stage
	if err := flattenJevosStage(stage); err != nil {
		st := s.probeJevosSettings()
		st.Detail = err.Error()
		return st, err
	}
	if err := unzipTo(modelPath, filepath.Join(stage, "model")); err != nil {
		// 有的 zip 自带 model/ 前缀
		if err2 := unzipTo(modelPath, stage); err2 != nil {
			st := s.probeJevosSettings()
			st.Detail = "解压模型失败: " + err.Error()
			return st, fmt.Errorf("%s", st.Detail)
		}
	}
	if _, err := flattenJevosModelDirectory(filepath.Join(stage, "model")); err != nil {
		st := s.probeJevosSettings()
		st.Detail = "整理模型目录失败: " + err.Error()
		return st, fmt.Errorf("%s", st.Detail)
	}

	bin := filepath.Join(stage, "jev")
	if runtime.GOOS == "windows" {
		bin = filepath.Join(stage, "jev.exe")
	}
	_ = os.Chmod(bin, 0o755)

	// 替换安装目录：旧目录改名归档
	if st, err := os.Stat(dir); err == nil && st.IsDir() {
		_ = os.Rename(dir, dir+".bak."+fmt.Sprintf("%d", time.Now().Unix()))
	}
	if err := os.Rename(stage, dir); err != nil {
		st := s.probeJevosSettings()
		st.Detail = "写入安装目录失败: " + err.Error()
		return st, fmt.Errorf("%s", st.Detail)
	}

	_ = s.writeJevosSettingsFile(jevosSettingsFile{
		Enabled:   false,
		PackageID: pkg.ID,
		UpdatedAt: time.Now().Format(time.RFC3339),
	})

	st := s.probeJevosSettings()
	if !st.Installed {
		st.Detail = "安装文件不完整：未检测到 JEV 运行时或 OpenVINO 模型"
		_ = s.saveJevosSettingsCache(st)
		return st, fmt.Errorf("%s", st.Detail)
	}
	st.Detail = "安装成功，请打开胶囊启用 JEV 常驻"
	_ = s.saveJevosSettingsCache(st)
	return st, nil
}

// SetJevosEnabled 胶囊开关：启停 LaunchAgent；若本机已有健康进程可直接采纳。
func (s *Service) SetJevosEnabled(enabled bool) (JevosSettingsStatus, error) {
	if enabled {
		st := s.probeJevosSettings()
		if !st.Installed && !st.Healthy {
			st.Detail = "请先从下方列表安装 JEV"
			return st, fmt.Errorf("%s", st.Detail)
		}
		if st.Healthy && !st.Installed {
			// 采纳外部已运行实例
			_ = s.writeJevosSettingsFile(jevosSettingsFile{Enabled: true, UpdatedAt: time.Now().Format(time.RFC3339)})
			st = s.probeJevosSettings()
			st.Detail = "已启用（使用本机已运行的 JEV）"
			_ = s.saveJevosSettingsCache(st)
			return st, nil
		}
		if err := s.startJevosLaunchAgent(); err != nil {
			// 端口被占用但已健康：仍记为启用
			if s.jevosHealthy() {
				_ = s.writeJevosSettingsFile(jevosSettingsFile{Enabled: true, PackageID: s.readJevosSettingsFile().PackageID, UpdatedAt: time.Now().Format(time.RFC3339)})
				st = s.probeJevosSettings()
				st.Detail = "端口已被占用，已采纳现有健康进程: " + err.Error()
				_ = s.saveJevosSettingsCache(st)
				return st, nil
			}
			st = s.probeJevosSettings()
			st.Detail = "启动失败: " + err.Error()
			return st, fmt.Errorf("%s", st.Detail)
		}
		_ = s.writeJevosSettingsFile(jevosSettingsFile{Enabled: true, PackageID: s.readJevosSettingsFile().PackageID, UpdatedAt: time.Now().Format(time.RFC3339)})
		// 等健康
		deadline := time.Now().Add(90 * time.Second)
		for time.Now().Before(deadline) {
			if s.jevosHealthy() {
				break
			}
			time.Sleep(800 * time.Millisecond)
		}
	} else {
		_ = s.stopJevosLaunchAgent()
		_ = s.writeJevosSettingsFile(jevosSettingsFile{Enabled: false, PackageID: s.readJevosSettingsFile().PackageID, UpdatedAt: time.Now().Format(time.RFC3339)})
	}
	st := s.probeJevosSettings()
	_ = s.saveJevosSettingsCache(st)
	return st, nil
}

// UninstallJevos 卸载平台安装的 JEV：停常驻、归档安装目录与配置（不 rm，避免留半截/误删）。
func (s *Service) UninstallJevos() (JevosSettingsStatus, error) {
	dir := s.jevosInstallDir()
	bin := filepath.Join(dir, "jev")
	if runtime.GOOS == "windows" {
		bin = filepath.Join(dir, "jev.exe")
	}
	if !fileExists(bin) {
		st := s.probeJevosSettings()
		st.Detail = "未检测到平台安装目录，无需卸载（本机外部 JEV 进程不受影响）"
		return st, fmt.Errorf("%s", st.Detail)
	}

	_ = s.stopJevosLaunchAgent()
	// 非 macOS 无 LaunchAgent：尽量结束本机 8017 上的 jev（失败不阻断归档）
	if runtime.GOOS != "darwin" {
		_ = s.stopJevosBackgroundBestEffort()
	}

	stamp := time.Now().Format("20060102150405")
	archived := dir + ".uninstalled." + stamp
	if err := os.Rename(dir, archived); err != nil {
		st := s.probeJevosSettings()
		st.Detail = "归档安装目录失败: " + err.Error()
		return st, fmt.Errorf("%s", st.Detail)
	}

	// 配置与缓存改名归档，避免下次误判已安装
	if p := s.jevosSettingsPath(); fileExists(p) {
		_ = os.Rename(p, p+".off."+stamp)
	}
	if p := s.jevosSettingsCachePath(); fileExists(p) {
		_ = os.Rename(p, p+".off."+stamp)
	}
	_ = s.writeJevosSettingsFile(jevosSettingsFile{
		Enabled:   false,
		UpdatedAt: time.Now().Format(time.RFC3339),
	})

	st := s.probeJevosSettings()
	st.Detail = "已卸载平台 JEV（归档至 " + archived + "）"
	_ = s.saveJevosSettingsCache(st)
	return st, nil
}

// RequireJevosEnabled 自动审核前置：已开启且健康。
func (s *Service) RequireJevosEnabled() error {
	st := s.probeJevosSettings()
	if !st.Enabled {
		return fmt.Errorf("请先在「设置 · JEV」中安装并开启 JEV（AI 自动审核前置条件）")
	}
	if !st.Healthy {
		return fmt.Errorf("JEV 未就绪（%s）。请在「设置 · JEV」检查或重新开启", st.Detail)
	}
	return nil
}

func (s *Service) probeJevosSettings() JevosSettingsStatus {
	tag := s.resolveJevosReleaseTag()
	dir := s.jevosInstallDir()
	bin := filepath.Join(dir, "jev")
	if runtime.GOOS == "windows" {
		bin = filepath.Join(dir, "jev.exe")
	}
	modelOK := fileExists(filepath.Join(dir, "model", "openvino_model.bin")) ||
		fileExists(filepath.Join(dir, "model", "model.json"))
	binOK := fileExists(bin)
	installed := binOK && modelOK
	healthy := s.jevosHealthy()
	cfg := s.readJevosSettingsFile()
	agentOn := s.jevosLaunchAgentLoaded()
	enabled := cfg.Enabled && (agentOn || healthy)

	detail := "未安装"
	switch {
	case installed && enabled && healthy:
		detail = "JEV 常驻中 · 健康"
	case installed && enabled && !healthy:
		detail = "已开启但未就绪，请查看 ~/.atolla/jevos.err.log"
	case installed && !enabled:
		detail = "已安装，胶囊关闭"
	case !installed && healthy:
		detail = "检测到本机 8017 已有 JEV 进程；可直接开启胶囊，或安装到 Atolla 目录以便托管"
	case !installed:
		detail = "未安装：请从下方选择平台包下载（GitHub feder-cr/jev）"
	}

	return JevosSettingsStatus{
		Installed:    installed,
		Enabled:      enabled,
		Healthy:      healthy,
		Detail:       detail,
		BinaryPath:   bin,
		InstallDir:   dir,
		ReleaseTag:   tag,
		ReleaseURL:   "https://github.com/" + jevosReleaseRepo + "/releases/tag/" + tag,
		HealthURL:    strings.TrimRight(s.Cfg.JevosURL, "/") + "/health",
		Packages:     s.jevosPackageCatalog(tag),
		ModelReady:   modelOK,
		LaunchAgent:  agentOn,
		CanUninstall: binOK, // 只要平台目录有二进制即可卸载归档
	}
}

func (s *Service) jevosPackageCatalog(tag string) []JevosPackage {
	base := "https://github.com/" + jevosReleaseRepo + "/releases/download/" + tag
	model := base + "/" + strings.ReplaceAll(jevosModelAsset, "jevos-v5", tag)
	// tag 已是 jevos-v5 时 asset 名就是 jevos-v5-openvino-int8.zip
	if tag == "jevos-v5" {
		model = base + "/" + jevosModelAsset
	} else {
		model = base + "/" + tag + "-openvino-int8.zip"
	}
	goos, goarch := runtime.GOOS, runtime.GOARCH
	pkgs := []JevosPackage{
		{
			ID: "macos-arm64", Name: "macOS Apple Silicon", OS: "darwin", Arch: "arm64",
			RuntimeURL: base + "/jev-macos-arm64.tar.gz", ModelURL: model,
			Recommended: goos == "darwin" && goarch == "arm64",
			SizeHint:    "运行时 ~21MB + 模型 ~600MB",
		},
		{
			ID: "linux-x64", Name: "Linux x64", OS: "linux", Arch: "amd64",
			RuntimeURL: base + "/jev-linux-x64.tar.gz", ModelURL: model,
			Recommended: goos == "linux" && (goarch == "amd64" || goarch == "x86_64"),
			SizeHint:    "运行时 ~26MB + 模型 ~600MB",
		},
		{
			ID: "windows-x64", Name: "Windows x64", OS: "windows", Arch: "amd64",
			RuntimeURL: base + "/jev-windows-x64.zip", ModelURL: model,
			Recommended: goos == "windows" && (goarch == "amd64" || goarch == "x86_64"),
			SizeHint:    "运行时 ~19MB + 模型 ~600MB",
		},
	}
	return pkgs
}

func (s *Service) resolveJevosReleaseTag() string {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+jevosReleaseRepo+"/releases/latest", nil)
	if err != nil {
		return jevosReleaseTag
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp == nil {
		return jevosReleaseTag
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return jevosReleaseTag
	}
	var body struct {
		TagName string `json:"tag_name"`
	}
	if json.NewDecoder(resp.Body).Decode(&body) != nil || strings.TrimSpace(body.TagName) == "" {
		return jevosReleaseTag
	}
	return body.TagName
}

func (s *Service) jevosInstallDir() string {
	return filepath.Join(homeDir(), ".atolla", "jevos")
}

func (s *Service) jevosHealthy() bool {
	url := strings.TrimRight(s.Cfg.JevosURL, "/") + "/health"
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp == nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return false
	}
	var body struct {
		Status string `json:"status"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&body)
	return body.Status == "ready" || body.Status == ""
}

func (s *Service) jevosSettingsPath() string {
	return filepath.Join(homeDir(), ".atolla", "jevos-settings.json")
}

func (s *Service) readJevosSettingsFile() jevosSettingsFile {
	raw, err := os.ReadFile(s.jevosSettingsPath())
	if err != nil {
		return jevosSettingsFile{}
	}
	var f jevosSettingsFile
	_ = json.Unmarshal(raw, &f)
	return f
}

func (s *Service) writeJevosSettingsFile(f jevosSettingsFile) error {
	path := s.jevosSettingsPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func (s *Service) jevosSettingsCachePath() string {
	return filepath.Join(homeDir(), ".atolla", "jevos-settings-cache.json")
}

func (s *Service) loadJevosSettingsCache() (JevosSettingsStatus, bool) {
	raw, err := os.ReadFile(s.jevosSettingsCachePath())
	if err != nil {
		return JevosSettingsStatus{}, false
	}
	var st JevosSettingsStatus
	if json.Unmarshal(raw, &st) != nil || st.CheckedAt == "" {
		return JevosSettingsStatus{}, false
	}
	return st, true
}

func (s *Service) saveJevosSettingsCache(st JevosSettingsStatus) error {
	path := s.jevosSettingsCachePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	st.Cached = true
	if st.CheckedAt == "" {
		st.CheckedAt = time.Now().Format(time.RFC3339)
	}
	raw, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, raw, 0o600)
}

func (s *Service) jevosPlistPath() string {
	return filepath.Join(homeDir(), "Library", "LaunchAgents", jevosLaunchLabel+".plist")
}

func (s *Service) jevosLaunchAgentLoaded() bool {
	if runtime.GOOS != "darwin" {
		return false
	}
	uid := os.Getuid()
	out, err := exec.Command("launchctl", "print", fmt.Sprintf("gui/%d/%s", uid, jevosLaunchLabel)).CombinedOutput()
	if err == nil && len(out) > 0 {
		return true
	}
	return false
}

func (s *Service) startJevosLaunchAgent() error {
	if runtime.GOOS != "darwin" {
		return s.startJevosBackground()
	}
	dir := s.jevosInstallDir()
	bin := filepath.Join(dir, "jev")
	if !fileExists(bin) {
		return fmt.Errorf("未找到二进制 %s", bin)
	}
	_ = os.Chmod(bin, 0o755)
	plist := s.jevosPlistPath()
	if err := os.MkdirAll(filepath.Dir(plist), 0o755); err != nil {
		return err
	}
	body := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>%s</string>
  <key>ProgramArguments</key>
  <array>
    <string>%s</string>
    <string>serve</string>
    <string>--host</string><string>127.0.0.1</string>
    <string>--port</string><string>8017</string>
  </array>
  <key>WorkingDirectory</key><string>%s</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>%s</string>
  <key>StandardErrorPath</key><string>%s</string>
</dict>
</plist>
`, jevosLaunchLabel, bin, dir,
		filepath.Join(homeDir(), ".atolla", "jevos.out.log"),
		filepath.Join(homeDir(), ".atolla", "jevos.err.log"),
	)
	if err := os.WriteFile(plist, []byte(body), 0o644); err != nil {
		return err
	}
	uid := os.Getuid()
	domain := fmt.Sprintf("gui/%d", uid)
	_ = exec.Command("launchctl", "bootout", domain+"/"+jevosLaunchLabel).Run()
	if out, err := exec.Command("launchctl", "bootstrap", domain, plist).CombinedOutput(); err != nil {
		if out2, err2 := exec.Command("launchctl", "load", plist).CombinedOutput(); err2 != nil {
			return fmt.Errorf("launchctl: %v / %s | %v / %s", err, strings.TrimSpace(string(out)), err2, strings.TrimSpace(string(out2)))
		}
	}
	_ = exec.Command("launchctl", "kickstart", "-k", domain+"/"+jevosLaunchLabel).Run()
	return nil
}

func (s *Service) stopJevosLaunchAgent() error {
	if runtime.GOOS != "darwin" {
		return nil
	}
	uid := os.Getuid()
	domain := fmt.Sprintf("gui/%d", uid)
	_ = exec.Command("launchctl", "bootout", domain+"/"+jevosLaunchLabel).Run()
	plist := s.jevosPlistPath()
	if fileExists(plist) {
		stamp := time.Now().Format("20060102150405")
		_ = os.Rename(plist, plist+".off."+stamp)
	}
	return nil
}

func (s *Service) startJevosBackground() error {
	dir := s.jevosInstallDir()
	bin := filepath.Join(dir, "jev")
	if runtime.GOOS == "windows" {
		bin = filepath.Join(dir, "jev.exe")
	}
	cmd := exec.Command(bin, "serve", "--host", "127.0.0.1", "--port", "8017")
	cmd.Dir = dir
	return cmd.Start()
}

// stopJevosBackgroundBestEffort 尽力结束非 LaunchAgent 启动的 jev（卸载用）。
func (s *Service) stopJevosBackgroundBestEffort() error {
	if runtime.GOOS == "windows" {
		return exec.Command("taskkill", "/IM", "jev.exe", "/F").Run()
	}
	// 仅匹配本机 serve 8017，避免误杀其它 jev 子命令
	return exec.Command("pkill", "-f", "jev serve.*--port 8017").Run()
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

var (
	jevosHTTPOnce   sync.Once
	jevosHTTPClient *http.Client
	jevosProxyOnce  sync.Once
	jevosProxyURL   *url.URL
)

// jevosDownloadClient：加长 TLS/拨号超时 + 系统代理。DefaultTransport 握手仅 10s，易在 github CDN 失败。
func jevosDownloadClient() *http.Client {
	jevosHTTPOnce.Do(func() {
		jevosHTTPClient = &http.Client{
			Transport: &http.Transport{
				Proxy: jevosHTTPProxy,
				DialContext: (&net.Dialer{
					Timeout:   45 * time.Second,
					KeepAlive: 30 * time.Second,
				}).DialContext,
				TLSHandshakeTimeout:   90 * time.Second,
				ResponseHeaderTimeout: 3 * time.Minute,
				ExpectContinueTimeout: 5 * time.Second,
				IdleConnTimeout:       90 * time.Second,
				ForceAttemptHTTP2:     true,
				MaxIdleConns:          8,
			},
		}
	})
	return jevosHTTPClient
}

func jevosHTTPProxy(req *http.Request) (*url.URL, error) {
	if u, err := http.ProxyFromEnvironment(req); err == nil && u != nil {
		return u, nil
	}
	if u := jevosMacSystemHTTPSProxy(); u != nil {
		return u, nil
	}
	return nil, nil
}

func jevosMacSystemHTTPSProxy() *url.URL {
	if runtime.GOOS != "darwin" {
		return nil
	}
	jevosProxyOnce.Do(func() {
		if raw := strings.TrimSpace(os.Getenv("ATOLLA_HTTPS_PROXY")); raw != "" {
			if u, err := url.Parse(raw); err == nil && u.Host != "" {
				jevosProxyURL = u
				return
			}
		}
		out, err := exec.Command("scutil", "--proxy").Output()
		if err != nil {
			return
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
		if enable && host != "" && port > 0 {
			jevosProxyURL = &url.URL{Scheme: "http", Host: net.JoinHostPort(host, strconv.Itoa(port))}
		}
	})
	return jevosProxyURL
}

// downloadJevosReleaseAsset：国内模式优先镜像；默认模式保持 gh → 直连 → 镜像兜底。
func downloadJevosReleaseAsset(ctx context.Context, rawURL, dest string, chinaMirror bool) error {
	var errs []string
	if !chinaMirror {
		if tag, asset, ok := parseGitHubReleaseDownloadURL(rawURL); ok {
			if err := downloadJevosViaGh(ctx, tag, asset, dest); err == nil {
				return nil
			} else {
				errs = append(errs, "gh: "+shortJevosDownloadErr(err))
			}
		}
	}
	for _, u := range jevosReleaseCandidates(rawURL, chinaMirror) {
		if err := downloadFileResilient(ctx, u, dest, 2); err == nil {
			return nil
		} else {
			errs = append(errs, shortJevosDownloadErr(err))
		}
		if ctx.Err() != nil {
			return fmt.Errorf("安装超过 %d 分钟未完成，已停止本次安装，请检查网络或切换镜像源后重试", int(jevosInstallTimeout/time.Minute))
		}
	}
	if len(errs) == 0 {
		return fmt.Errorf("无可用下载源")
	}
	hint := "（可开启系统 HTTPS 代理，或设置 HTTPS_PROXY / ATOLLA_HTTPS_PROXY）"
	return fmt.Errorf("%s%s", errs[0], hint)
}

func jevosReleaseCandidates(rawURL string, chinaMirror bool) []string {
	mirrors := jevosReleaseMirrorURLs(rawURL)
	if chinaMirror {
		return append(mirrors, rawURL)
	}
	return append([]string{rawURL}, mirrors...)
}

func parseGitHubReleaseDownloadURL(raw string) (tag, asset string, ok bool) {
	const marker = "github.com/"
	i := strings.Index(raw, marker)
	if i < 0 {
		return "", "", false
	}
	rest := raw[i+len(marker):]
	// owner/repo/releases/download/<tag>/<asset>
	parts := strings.Split(rest, "/")
	if len(parts) < 6 || parts[2] != "releases" || parts[3] != "download" {
		return "", "", false
	}
	tag = parts[4]
	asset = parts[5]
	if q := strings.IndexByte(asset, '?'); q >= 0 {
		asset = asset[:q]
	}
	if tag == "" || asset == "" {
		return "", "", false
	}
	return tag, asset, true
}

func jevosReleaseMirrorURLs(githubURL string) []string {
	if !strings.Contains(githubURL, "github.com/") {
		return nil
	}
	prefixes := []string{
		"https://ghfast.top/",
		"https://ghproxy.net/",
		"https://mirror.ghproxy.com/",
	}
	out := make([]string, 0, len(prefixes))
	for _, p := range prefixes {
		out = append(out, p+githubURL)
	}
	return out
}

func downloadJevosViaGh(parent context.Context, tag, assetName, dest string) error {
	gh, err := exec.LookPath("gh")
	if err != nil {
		return fmt.Errorf("gh 不可用")
	}
	dir := filepath.Dir(dest)
	stage := filepath.Join(dir, "gh-dl-"+fmt.Sprintf("%d", time.Now().UnixNano()))
	if err := os.MkdirAll(stage, 0o755); err != nil {
		return err
	}
	defer func() {
		_ = os.Rename(stage, stage+".done."+fmt.Sprintf("%d", time.Now().Unix()))
	}()
	ctx, cancel := context.WithTimeout(parent, jevosSourceTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, gh, "release", "download", tag,
		"--repo", jevosReleaseRepo,
		"--pattern", assetName,
		"--dir", stage,
		"--clobber",
	)
	cmd.Env = append(os.Environ(), "GH_PROMPT_DISABLED=1", "GIT_TERMINAL_PROMPT=0")
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return fmt.Errorf("%s", msg)
	}
	got := filepath.Join(stage, assetName)
	if !fileExists(got) {
		entries, _ := os.ReadDir(stage)
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			got = filepath.Join(stage, e.Name())
			break
		}
	}
	if !fileExists(got) {
		return fmt.Errorf("gh 下载后未找到 %s", assetName)
	}
	return copyFileBytes(got, dest)
}

func copyFileBytes(src, dest string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func downloadFileResilient(ctx context.Context, rawURL, dest string, attempts int) error {
	if attempts < 1 {
		attempts = 1
	}
	var last error
	for i := 0; i < attempts; i++ {
		if i > 0 {
			select {
			case <-time.After(time.Duration(i) * 2 * time.Second):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		_ = os.Rename(dest, dest+".partial."+fmt.Sprintf("%d", time.Now().UnixNano()))
		last = downloadFileOnceWithTimeout(ctx, rawURL, dest, jevosSourceTimeout)
		if last == nil {
			return nil
		}
		if !jevosRetryableDownloadErr(last) {
			return last
		}
	}
	return last
}

func downloadFileOnceWithTimeout(parent context.Context, rawURL, dest string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Atolla-JevosInstaller/1.1")
	req.Header.Set("Accept", "*/*")
	resp, err := jevosDownloadClient().Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("下载源超过 %d 分钟无法完成: %w", int(timeout/time.Minute), context.DeadlineExceeded)
		}
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(f, resp.Body)
	closeErr := f.Close()
	if copyErr != nil {
		if errors.Is(copyErr, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("下载源超过 %d 分钟无法完成: %w", int(timeout/time.Minute), context.DeadlineExceeded)
		}
		return copyErr
	}
	return closeErr
}

func jevosRetryableDownloadErr(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "tls handshake timeout") ||
		strings.Contains(s, "timeout") ||
		strings.Contains(s, "deadline exceeded") ||
		strings.Contains(s, "connection reset") ||
		strings.Contains(s, "connection refused") ||
		strings.Contains(s, "temporary") ||
		strings.Contains(s, "i/o timeout") ||
		strings.Contains(s, "eof")
}

func shortJevosDownloadErr(err error) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	low := strings.ToLower(s)
	switch {
	case strings.Contains(low, "tls handshake timeout"):
		return "TLS 握手超时"
	case strings.Contains(low, "timeout") || strings.Contains(low, "deadline exceeded"):
		return "连接超时"
	case strings.Contains(low, "connection reset"):
		return "连接被重置"
	case strings.Contains(low, "connection refused"):
		return "连接被拒绝"
	default:
		if len(s) > 120 {
			return s[:120] + "…"
		}
		return s
	}
}

func untarGzTo(src, dest string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		name := filepath.Clean(hdr.Name)
		if strings.HasPrefix(name, "..") {
			continue
		}
		target := filepath.Join(dest, name)
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(hdr.Mode)|0o644)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			out.Close()
		}
	}
	return nil
}

func unzipTo(src, dest string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()
	for _, f := range r.File {
		name := filepath.Clean(f.Name)
		if strings.HasPrefix(name, "..") {
			continue
		}
		target := filepath.Join(dest, name)
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode())
		if err != nil {
			rc.Close()
			return err
		}
		_, copyErr := io.Copy(out, rc)
		out.Close()
		rc.Close()
		if copyErr != nil {
			return copyErr
		}
	}
	return nil
}

// flattenJevosStage 若 Release 将运行时包在 stage/jev/ 下，提升到 stage 根目录。
// 先把目录改名释放 stage/jev，才能将同名可执行文件移动到目标位置。
func flattenJevosStage(stage string) error {
	nested := filepath.Join(stage, "jev")
	st, err := os.Stat(nested)
	if err != nil || !st.IsDir() {
		return nil
	}

	binaryName := "jev"
	if runtime.GOOS == "windows" {
		binaryName = "jev.exe"
	}
	if !fileExists(filepath.Join(nested, binaryName)) {
		return fmt.Errorf("解压后未找到 %s", binaryName)
	}

	archivedRuntime := nested + ".payload." + fmt.Sprintf("%d", time.Now().UnixNano())
	if err := os.Rename(nested, archivedRuntime); err != nil {
		return err
	}

	entries, err := os.ReadDir(archivedRuntime)
	if err != nil {
		return err
	}
	for _, e := range entries {
		from := filepath.Join(archivedRuntime, e.Name())
		to := filepath.Join(stage, e.Name())
		if err := os.Rename(from, to); err != nil {
			return err
		}
	}
	// 空目录改名归档（禁止 rm），保留诊断痕迹。
	_ = os.Rename(archivedRuntime, archivedRuntime+".empty")
	if !fileExists(filepath.Join(stage, binaryName)) {
		return fmt.Errorf("解压后未找到 %s", binaryName)
	}
	return nil
}

// flattenJevosModelDirectory 移除模型压缩包自带的 model/ 前缀，统一为 model/<artifact>。
// 返回 changed=true 时调用方必须绕过旧状态缓存重新探测安装结果。
func flattenJevosModelDirectory(modelDir string) (bool, error) {
	nestedModelDir := filepath.Join(modelDir, "model")
	st, err := os.Stat(nestedModelDir)
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !st.IsDir() {
		return false, nil
	}

	entries, err := os.ReadDir(nestedModelDir)
	if err != nil {
		return false, err
	}
	for _, entry := range entries {
		from := filepath.Join(nestedModelDir, entry.Name())
		to := filepath.Join(modelDir, entry.Name())
		if _, err := os.Stat(to); err == nil {
			return false, fmt.Errorf("目标已存在: %s", entry.Name())
		} else if !os.IsNotExist(err) {
			return false, err
		}
		if err := os.Rename(from, to); err != nil {
			return false, err
		}
	}

	// 空目录改名归档，遵守安装目录不直接删除的策略并保留排障痕迹。
	_ = os.Rename(nestedModelDir, nestedModelDir+".empty."+fmt.Sprintf("%d", time.Now().UnixNano()))
	return true, nil
}
