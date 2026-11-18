package service

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

// IOSAppInfo 管理台「App」页展示的版本与真机锁定信息。
type IOSAppInfo struct {
	Version     string `json:"version"`
	BuildNumber string `json:"build_number"`
	BundleID    string `json:"bundle_id"`
	DisplayName string `json:"display_name"`
	TeamID      string `json:"team_id,omitempty"`
	MinOS       string `json:"min_os,omitempty"`
	DeviceName  string `json:"device_name,omitempty"`
	DeviceUDID  string `json:"device_udid,omitempty"`
	DeviceModel string `json:"device_model,omitempty"`
	DeviceOS    string `json:"device_os,omitempty"`
	Destination string `json:"destination,omitempty"`
	ExcludeSims bool   `json:"exclude_simulators"`
	WebRoot     string `json:"web_root,omitempty"`
	Workspace   string `json:"workspace,omitempty"`
	Scheme      string `json:"scheme,omitempty"`
	DarwinOK    bool   `json:"darwin_ok"`
	XcodeOK     bool   `json:"xcode_ok"`
	XcodePath   string `json:"xcode_path,omitempty"`
	ScriptOK    bool   `json:"script_ok"`
	TargetOK    bool   `json:"target_ok"`
	Detail      string `json:"detail,omitempty"`
}

// IOSAppBuildJobPublic 构建任务对外状态。
type IOSAppBuildJobPublic struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Done  bool   `json:"done"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
	Lines int    `json:"lines"`
}

type iosBuildJob struct {
	id   string
	kind string

	mu     sync.Mutex
	lines  []string
	done   bool
	ok     bool
	errMsg string
	subs   map[chan string]struct{}
}

type iosBuildJobHub struct {
	mu      sync.Mutex
	current *iosBuildJob
	byID    map[string]*iosBuildJob
	history []IOSAppBuildHistoryItem
}

// IOSAppBuildHistoryItem 近期构建记录（进程内）。
type IOSAppBuildHistoryItem struct {
	ID         string `json:"id"`
	Mode       string `json:"mode,omitempty"`
	StartedAt  string `json:"started_at"`
	FinishedAt string `json:"finished_at,omitempty"`
	OK         bool   `json:"ok"`
	Error      string `json:"error,omitempty"`
	Version    string `json:"version,omitempty"`
	Build      string `json:"build,omitempty"`
	Device     string `json:"device,omitempty"`
	Product    string `json:"product,omitempty"`
}

// IOSAppBuildOptions 控制增量/全量构建，并可临时指定完整 Xcode。
type IOSAppBuildOptions struct {
	Mode      string `json:"mode"`
	XcodePath string `json:"xcode_path"`
}

func newIOSBuildJobID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("ios-%d-%s", time.Now().Unix(), hex.EncodeToString(b[:]))
}

func newIOSBuildJob(kind string) *iosBuildJob {
	return &iosBuildJob{
		id:   newIOSBuildJobID(),
		kind: kind,
		subs: map[chan string]struct{}{},
	}
}

func (j *iosBuildJob) appendLine(line string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.lines = append(j.lines, line)
	for ch := range j.subs {
		select {
		case ch <- line:
		default:
		}
	}
}

func (j *iosBuildJob) finish(ok bool, errMsg string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.done = true
	j.ok = ok
	j.errMsg = errMsg
	for ch := range j.subs {
		close(ch)
	}
	j.subs = map[chan string]struct{}{}
}

func (j *iosBuildJob) snapshot() (lines []string, done, ok bool, errMsg string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	lines = append([]string(nil), j.lines...)
	return lines, j.done, j.ok, j.errMsg
}

func (j *iosBuildJob) subscribe() (lines []string, ch chan string, done, ok bool, errMsg string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	lines = append([]string(nil), j.lines...)
	if j.done {
		return lines, nil, true, j.ok, j.errMsg
	}
	ch = make(chan string, 64)
	j.subs[ch] = struct{}{}
	return lines, ch, false, false, ""
}

func (j *iosBuildJob) unsubscribe(ch chan string) {
	if ch == nil {
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	delete(j.subs, ch)
}

func (s *Service) iosBuildHub() *iosBuildJobHub {
	s.iosBuildJobOnce.Do(func() {
		s.iosBuildJobs = &iosBuildJobHub{byID: map[string]*iosBuildJob{}}
	})
	return s.iosBuildJobs
}

// GetIOSAppInfo 读取 App 版本、真机锁定与本机构建环境。
func (s *Service) GetIOSAppInfo() (IOSAppInfo, error) {
	info := IOSAppInfo{
		DisplayName: "Atolla",
		BundleID:    "com.atolla.mobile",
		Scheme:      "App",
		ExcludeSims: true,
		DarwinOK:    runtime.GOOS == "darwin",
	}
	webRoot, script, targetJSON, err := s.resolveIOSWebPaths()
	if err != nil {
		info.Detail = err.Error()
		return info, nil
	}
	info.WebRoot = webRoot
	info.Workspace = filepath.Join(webRoot, "ios", "App", "App.xcworkspace")
	info.ScriptOK = fileExists(script)
	info.TargetOK = fileExists(targetJSON)
	// 仅能找到 CLT 的 xcodebuild 仍会报错；必须实际执行版本检查。
	info.XcodeOK = runtime.GOOS == "darwin" && xcodeBuildUsable("")
	if info.XcodeOK {
		info.XcodePath = activeXcodeAppPath()
	}

	if pb := filepath.Join(webRoot, "ios", "App", "App.xcodeproj", "project.pbxproj"); fileExists(pb) {
		raw, _ := os.ReadFile(pb)
		text := string(raw)
		info.Version = firstMatch(text, `MARKETING_VERSION = ([0-9.]+);`)
		info.BuildNumber = firstMatch(text, `CURRENT_PROJECT_VERSION = ([0-9]+);`)
		info.TeamID = firstMatch(text, `DEVELOPMENT_TEAM = ([A-Z0-9]+);`)
		info.MinOS = firstMatch(text, `IPHONEOS_DEPLOYMENT_TARGET = ([0-9.]+);`)
		if bid := firstMatch(text, `PRODUCT_BUNDLE_IDENTIFIER = (com\.atolla\.mobile);`); bid != "" {
			info.BundleID = bid
		}
	}
	if info.Version == "" {
		info.Version = "—"
	}
	if info.BuildNumber == "" {
		info.BuildNumber = "—"
	}

	if info.TargetOK {
		var tgt struct {
			ExcludeSimulators bool   `json:"excludeSimulators"`
			SDK               string `json:"sdk"`
			Scheme            string `json:"scheme"`
			Destination       string `json:"xcodebuildDestination"`
			Device            struct {
				Name  string `json:"name"`
				Model string `json:"model"`
				OS    string `json:"os"`
				UDID  string `json:"udid"`
			} `json:"device"`
		}
		if b, rerr := os.ReadFile(targetJSON); rerr == nil && json.Unmarshal(b, &tgt) == nil {
			info.ExcludeSims = tgt.ExcludeSimulators
			info.Destination = tgt.Destination
			info.DeviceName = tgt.Device.Name
			info.DeviceModel = tgt.Device.Model
			info.DeviceOS = tgt.Device.OS
			info.DeviceUDID = tgt.Device.UDID
			if tgt.Scheme != "" {
				info.Scheme = tgt.Scheme
			}
		}
	}

	switch {
	case !info.DarwinOK:
		info.Detail = "iOS 真机构建仅支持在 macOS 本机执行"
	case !info.XcodeOK:
		info.Detail = "当前未检测到可用 Xcode，可在 App 页面指定 Xcode.app 目录"
	case !info.ScriptOK:
		info.Detail = "缺少构建脚本 scripts/ios-build-and-run-device.sh"
	case !info.TargetOK:
		info.Detail = "缺少真机锁定配置 ios/build-target.json"
	case info.DeviceUDID == "":
		info.Detail = "build-target.json 未配置真机 UDID"
	default:
		info.Detail = fmt.Sprintf("已锁定真机 %s · %s (%s)", info.DeviceName, info.Version, info.BuildNumber)
	}
	return info, nil
}

// ListIOSAppBuildHistory 返回近期构建记录。
func (s *Service) ListIOSAppBuildHistory() []IOSAppBuildHistoryItem {
	hub := s.iosBuildHub()
	hub.mu.Lock()
	defer hub.mu.Unlock()
	out := make([]IOSAppBuildHistoryItem, len(hub.history))
	copy(out, hub.history)
	return out
}

// StartIOSAppBuildAndRun 启动真机构建任务（全局单任务）。
func (s *Service) StartIOSAppBuildAndRun(opts IOSAppBuildOptions) (string, error) {
	if runtime.GOOS != "darwin" {
		return "", fmt.Errorf("iOS 真机构建仅支持 macOS")
	}
	mode, err := normalizeIOSBuildMode(opts.Mode)
	if err != nil {
		return "", err
	}
	xcodeApp, developerDir, err := resolveIOSXcodePath(opts.XcodePath)
	if err != nil {
		return "", err
	}
	webRoot, script, targetJSON, err := s.resolveIOSWebPaths()
	if err != nil {
		return "", err
	}
	if !fileExists(script) {
		return "", fmt.Errorf("构建脚本不存在: %s", script)
	}
	if !fileExists(targetJSON) {
		return "", fmt.Errorf("缺少真机锁定配置: %s", targetJSON)
	}

	hub := s.iosBuildHub()
	hub.mu.Lock()
	if hub.current != nil {
		_, done, _, _ := hub.current.snapshot()
		if !done {
			hub.mu.Unlock()
			return "", fmt.Errorf("another ios build job is running")
		}
	}
	job := newIOSBuildJob(mode + "_build_and_run")
	hub.current = job
	hub.byID[job.id] = job
	hub.mu.Unlock()

	info, _ := s.GetIOSAppInfo()
	item := IOSAppBuildHistoryItem{
		ID:        job.id,
		Mode:      mode,
		StartedAt: time.Now().Format(time.RFC3339),
		Version:   info.Version,
		Build:     info.BuildNumber,
		Device:    info.DeviceName,
		Product:   filepath.Join(webRoot, "ios", "build-device", "Build", "Products", "Debug-iphoneos", "App.app"),
	}
	hub.mu.Lock()
	hub.history = append([]IOSAppBuildHistoryItem{item}, hub.history...)
	if len(hub.history) > 20 {
		hub.history = hub.history[:20]
	}
	hub.mu.Unlock()

	go s.runIOSBuildJob(job, script, webRoot, item.ID, mode, xcodeApp, developerDir)
	return job.id, nil
}

func (s *Service) runIOSBuildJob(job *iosBuildJob, script, webRoot, historyID, mode, xcodeApp, developerDir string) {
	job.appendLine(fmt.Sprintf("==> starting ios %s build_and_run (device only)", mode))
	job.appendLine("web: " + webRoot)
	job.appendLine("script: " + script)

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(ctx, script)
	cmd.Dir = webRoot
	cmd.Env = append(os.Environ(),
		"ATOLLA_IOS_BUILD_NONINTERACTIVE=1",
		"ATOLLA_IOS_BUILD_MODE="+mode,
	)
	if developerDir != "" {
		cmd.Env = append(cmd.Env,
			"DEVELOPER_DIR="+developerDir,
			"ATOLLA_XCODE_APP_PATH="+xcodeApp,
		)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.finishIOSBuildHistory(historyID, false, err.Error())
		job.finish(false, err.Error())
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.finishIOSBuildHistory(historyID, false, err.Error())
		job.finish(false, err.Error())
		return
	}
	if err := cmd.Start(); err != nil {
		s.finishIOSBuildHistory(historyID, false, err.Error())
		job.finish(false, err.Error())
		return
	}

	var wg sync.WaitGroup
	pump := func(r io.Reader) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		buf := make([]byte, 0, 64*1024)
		sc.Buffer(buf, 1024*1024)
		for sc.Scan() {
			job.appendLine(sc.Text())
		}
	}
	wg.Add(2)
	go pump(stdout)
	go pump(stderr)
	wg.Wait()

	err = cmd.Wait()
	if ctx.Err() != nil {
		job.appendLine("error: timed out")
		s.finishIOSBuildHistory(historyID, false, "timed out")
		job.finish(false, "timed out")
		return
	}
	if err != nil {
		job.appendLine("error: " + err.Error())
		s.finishIOSBuildHistory(historyID, false, err.Error())
		job.finish(false, err.Error())
		return
	}
	job.appendLine("==> finished OK")
	s.finishIOSBuildHistory(historyID, true, "")
	job.finish(true, "")
}

func (s *Service) finishIOSBuildHistory(id string, ok bool, errMsg string) {
	hub := s.iosBuildHub()
	hub.mu.Lock()
	defer hub.mu.Unlock()
	for i := range hub.history {
		if hub.history[i].ID == id {
			hub.history[i].OK = ok
			hub.history[i].Error = errMsg
			hub.history[i].FinishedAt = time.Now().Format(time.RFC3339)
			return
		}
	}
}

// GetIOSAppBuildJob 返回任务状态。
func (s *Service) GetIOSAppBuildJob(id string) (IOSAppBuildJobPublic, error) {
	hub := s.iosBuildHub()
	hub.mu.Lock()
	job := hub.byID[id]
	hub.mu.Unlock()
	if job == nil {
		return IOSAppBuildJobPublic{}, fmt.Errorf("job not found")
	}
	lines, done, ok, errMsg := job.snapshot()
	return IOSAppBuildJobPublic{
		ID: job.id, Kind: job.kind, Done: done, OK: ok, Error: errMsg, Lines: len(lines),
	}, nil
}

// SubscribeIOSAppBuildJob 订阅日志。
func (s *Service) SubscribeIOSAppBuildJob(id string) (lines []string, ch chan string, done, ok bool, errMsg string, err error) {
	hub := s.iosBuildHub()
	hub.mu.Lock()
	job := hub.byID[id]
	hub.mu.Unlock()
	if job == nil {
		return nil, nil, false, false, "", fmt.Errorf("job not found")
	}
	lines, ch, done, ok, errMsg = job.subscribe()
	return lines, ch, done, ok, errMsg, nil
}

// UnsubscribeIOSAppBuildJob 取消订阅。
func (s *Service) UnsubscribeIOSAppBuildJob(id string, ch chan string) {
	if ch == nil {
		return
	}
	hub := s.iosBuildHub()
	hub.mu.Lock()
	job := hub.byID[id]
	hub.mu.Unlock()
	if job != nil {
		job.unsubscribe(ch)
	}
}

// SnapshotIOSAppBuildJob 终态快照。
func (s *Service) SnapshotIOSAppBuildJob(id string) (done, ok bool, errMsg string, err error) {
	hub := s.iosBuildHub()
	hub.mu.Lock()
	job := hub.byID[id]
	hub.mu.Unlock()
	if job == nil {
		return false, false, "", fmt.Errorf("job not found")
	}
	_, done, ok, errMsg = job.snapshot()
	return done, ok, errMsg, nil
}

func (s *Service) resolveIOSWebPaths() (webRoot, script, targetJSON string, err error) {
	root := strings.TrimSpace(s.Cfg.WorkspaceRoot)
	candidates := []string{}
	if root != "" {
		candidates = append(candidates,
			filepath.Join(root, "remote-relay", "web"),
			filepath.Join(root, "colleague-avatar", "remote-relay", "web"),
		)
	}
	if wd, werr := os.Getwd(); werr == nil {
		candidates = append(candidates,
			filepath.Join(wd, "remote-relay", "web"),
			filepath.Join(wd, "..", "remote-relay", "web"),
			filepath.Join(wd, "..", "..", "remote-relay", "web"),
		)
	}
	for _, c := range candidates {
		c = filepath.Clean(c)
		sc := filepath.Join(c, "scripts", "ios-build-and-run-device.sh")
		tj := filepath.Join(c, "ios", "build-target.json")
		if fileExists(filepath.Join(c, "package.json")) {
			return c, sc, tj, nil
		}
	}
	return "", "", "", fmt.Errorf("找不到 remote-relay/web（请检查 WorkspaceRoot）")
}

func normalizeIOSBuildMode(raw string) (string, error) {
	mode := strings.ToLower(strings.TrimSpace(raw))
	if mode == "" {
		return "incremental", nil
	}
	if mode != "incremental" && mode != "full" {
		return "", fmt.Errorf("不支持的 iOS 构建方式: %s", raw)
	}
	return mode, nil
}

// resolveIOSXcodePath 接受 Xcode.app 或 Contents/Developer，避免修改全局 xcode-select。
func resolveIOSXcodePath(raw string) (appPath, developerDir string, err error) {
	appPath, developerDir, err = normalizeIOSXcodePath(raw)
	if err != nil || appPath == "" {
		return appPath, developerDir, err
	}

	st, statErr := os.Stat(appPath)
	if statErr != nil || !st.IsDir() {
		return "", "", fmt.Errorf("Xcode 应用不存在: %s", appPath)
	}
	if !fileExists(filepath.Join(developerDir, "usr", "bin", "xcodebuild")) {
		return "", "", fmt.Errorf("所选目录不是完整 Xcode: %s", appPath)
	}
	// 首次未启动时尽量隐藏拉起；失败不阻断，最终以 xcodebuild 自检结果为准。
	_ = exec.Command("open", "-gj", appPath).Run()
	if !xcodeBuildUsable(developerDir) {
		return "", "", fmt.Errorf("所选 Xcode 当前不可用，请确认已完成首次启动和许可确认")
	}
	return appPath, developerDir, nil
}

func normalizeIOSXcodePath(raw string) (appPath, developerDir string, err error) {
	path := filepath.Clean(strings.TrimSpace(raw))
	if path == "." || path == "" {
		return "", "", nil
	}
	if !filepath.IsAbs(path) {
		return "", "", fmt.Errorf("Xcode 路径必须是绝对路径")
	}
	if strings.HasSuffix(path, filepath.Join("Contents", "Developer")) {
		developerDir = path
		appPath = filepath.Dir(filepath.Dir(path))
	} else if strings.EqualFold(filepath.Ext(path), ".app") {
		appPath = path
		developerDir = filepath.Join(path, "Contents", "Developer")
	} else {
		return "", "", fmt.Errorf("请选择 Xcode.app 或其 Contents/Developer 目录")
	}
	return appPath, developerDir, nil
}

func xcodeBuildUsable(developerDir string) bool {
	bin := "xcodebuild"
	if developerDir != "" {
		bin = filepath.Join(developerDir, "usr", "bin", "xcodebuild")
	}
	cmd := exec.Command(bin, "-version")
	if developerDir != "" {
		cmd.Env = append(os.Environ(), "DEVELOPER_DIR="+developerDir)
	}
	return cmd.Run() == nil
}

func activeXcodeAppPath() string {
	out, err := exec.Command("xcode-select", "-p").Output()
	if err != nil {
		return ""
	}
	appPath, _, err := normalizeIOSXcodePath(strings.TrimSpace(string(out)))
	if err != nil {
		return ""
	}
	return appPath
}

func lookPathOK(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func firstMatch(src string, patterns ...string) string {
	for _, p := range patterns {
		re := regexp.MustCompile(p)
		m := re.FindStringSubmatch(src)
		if len(m) >= 2 {
			return m[1]
		}
	}
	return ""
}
