package service

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	jevosReleaseRepo = "feder-cr/jev"
	jevosReleaseTag  = "jevos-v5" // 默认；可被 GitHub latest 覆盖
	jevosLaunchLabel = "com.atolla.jevos"
	jevosModelAsset  = "jevos-v5-openvino-int8.zip"
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
	Installed   bool           `json:"installed"`
	Enabled     bool           `json:"enabled"`
	Healthy     bool           `json:"healthy"`
	Detail      string         `json:"detail"`
	BinaryPath  string         `json:"binary_path"`
	InstallDir  string         `json:"install_dir"`
	ReleaseTag  string         `json:"release_tag"`
	ReleaseURL  string         `json:"release_url"`
	HealthURL   string         `json:"health_url"`
	Packages    []JevosPackage `json:"packages"`
	Cached      bool           `json:"cached"`
	CheckedAt   string         `json:"checked_at"`
	ModelReady  bool           `json:"model_ready"`
	LaunchAgent bool           `json:"launch_agent"`
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
func (s *Service) JevosSettingsInstall(packageID string) (any, error) {
	st, err := s.InstallJevos(packageID)
	return st, err
}

// JevosSettingsSet implements remotebridge.AgentRuntime。
func (s *Service) JevosSettingsSet(enabled bool) (any, error) {
	st, err := s.SetJevosEnabled(enabled)
	return st, err
}

// GetJevosSettingsStatus 读取 JEV 状态；force 时重检。
func (s *Service) GetJevosSettingsStatus(force bool) (JevosSettingsStatus, error) {
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
func (s *Service) InstallJevos(packageID string) (JevosSettingsStatus, error) {
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

	if err := downloadFile(pkg.RuntimeURL, runtimePath); err != nil {
		st := s.probeJevosSettings()
		st.Detail = "下载运行时失败: " + err.Error()
		return st, fmt.Errorf("%s", st.Detail)
	}
	if err := downloadFile(pkg.ModelURL, modelPath); err != nil {
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
		Installed:   installed,
		Enabled:     enabled,
		Healthy:     healthy,
		Detail:      detail,
		BinaryPath:  bin,
		InstallDir:  dir,
		ReleaseTag:  tag,
		ReleaseURL:  "https://github.com/" + jevosReleaseRepo + "/releases/tag/" + tag,
		HealthURL:   strings.TrimRight(s.Cfg.JevosURL, "/") + "/health",
		Packages:    s.jevosPackageCatalog(tag),
		ModelReady:  modelOK,
		LaunchAgent: agentOn,
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

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func downloadFile(url, dest string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "Atolla-JevosInstaller/1.0")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("HTTP %d %s", resp.StatusCode, url)
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

// flattenJevosStage 若 stage/jev/jev 存在，把 jev/* 提到 stage。
func flattenJevosStage(stage string) error {
	nested := filepath.Join(stage, "jev")
	st, err := os.Stat(nested)
	if err != nil || !st.IsDir() {
		return nil
	}
	// 已是扁平（stage/jev 是二进制）则跳过
	if fileExists(nested) {
		return nil
	}
	entries, err := os.ReadDir(nested)
	if err != nil {
		return err
	}
	for _, e := range entries {
		from := filepath.Join(nested, e.Name())
		to := filepath.Join(stage, e.Name())
		if err := os.Rename(from, to); err != nil {
			return err
		}
	}
	// 空目录改名归档（禁止 rm）
	_ = os.Rename(nested, nested+".empty."+fmt.Sprintf("%d", time.Now().Unix()))
	if !fileExists(filepath.Join(stage, "jev")) && !fileExists(filepath.Join(stage, "jev.exe")) {
		return fmt.Errorf("解压后未找到 jev 二进制")
	}
	return nil
}
