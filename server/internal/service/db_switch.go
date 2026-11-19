package service

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"atolla/server/internal/dbconfig"
	"atolla/server/internal/dbmigrate"
	"atolla/server/internal/store"
)

// DBStatus 数据库配置与探测状态。
type DBStatus struct {
	Driver             string `json:"driver"`
	DSNDisplay         string `json:"dsn_display"`
	Chosen             bool   `json:"chosen"`
	SQLitePath         string `json:"sqlite_path"`          // 当前生效路径
	SQLiteDefaultPath  string `json:"sqlite_default_path"`  // 平台默认路径
	SQLiteWritable     bool   `json:"sqlite_writable"`
	DockerAvailable    bool   `json:"docker_available"`
	MySQLReachable     bool   `json:"mysql_reachable"`
	HasData            bool   `json:"has_data"`
	OtherHasData       bool   `json:"other_has_data,omitempty"`
	Migrate            dbmigrate.Progress `json:"migrate"`
	RestartCommand     string `json:"restart_command"`
}

// DBSwitchReq 切换请求。
type DBSwitchReq struct {
	Driver  string `json:"driver"`
	Migrate bool   `json:"migrate"`
}

// DBSQLitePathReq 指定 SQLite 文件路径。
type DBSQLitePathReq struct {
	Path    string `json:"path"`
	Migrate bool   `json:"migrate"`
}

// DBSwitchResult 切换结果。
type DBSwitchResult struct {
	Driver  string `json:"driver"`
	Restart string `json:"restart"` // pending | manual | none | desktop
	Command string `json:"command"`
	Message string `json:"message,omitempty"`
}

// isDesktopApp 是否由 Electron 桌面壳托管（勿调用仓库 restart.sh）。
func isDesktopApp() bool {
	if strings.TrimSpace(os.Getenv("AVATAR_DESKTOP")) == "1" {
		return true
	}
	return strings.TrimSpace(os.Getenv(dbconfig.EnvRuntimeRoot)) != ""
}

// applyConfigRestart 配置落盘后选择重启策略：桌面端交还主进程 relaunch，Web 走 restart.sh。
func applyConfigRestart(repoRoot, driver string) DBSwitchResult {
	res := DBSwitchResult{Driver: driver, Command: "./scripts/restart.sh", Restart: "none"}
	if isDesktopApp() {
		res.Restart = "desktop"
		res.Command = ""
		res.Message = "配置已保存，桌面应用即将重启"
		return res
	}
	if startRestart(repoRoot) {
		res.Restart = "pending"
		res.Message = "配置已保存，正在重启…"
		return res
	}
	res.Restart = "manual"
	res.Message = "配置已保存，请手动执行重启命令"
	return res
}

func (s *Service) repoRoot() (string, error) {
	return dbconfig.RepoRoot()
}

// GetDBStatus 聚合当前驱动与环境探测。
func (s *Service) GetDBStatus(ctx context.Context) (DBStatus, error) {
	root, err := s.repoRoot()
	if err != nil {
		return DBStatus{}, err
	}
	driver := dbconfig.NormalizeDriver(s.Cfg.DBDriver)
	sqlitePath := dbconfig.EffectiveSQLitePath(root, driver, s.Cfg.DBDSN)
	restartCmd := "./scripts/restart.sh"
	if isDesktopApp() {
		restartCmd = ""
	}
	st := DBStatus{
		Driver:            driver,
		DSNDisplay:        redactDSNDisplay(driver, s.Cfg.DBDSN),
		Chosen:            dbconfig.Chosen(root),
		SQLitePath:        sqlitePath,
		SQLiteDefaultPath: dbconfig.SQLiteDSN(root),
		RestartCommand:    restartCmd,
		Migrate:           dbmigrate.Current(),
	}
	st.SQLiteWritable = canWriteDir(filepath.Dir(st.SQLitePath))
	st.DockerAvailable = dockerAvailable()
	st.MySQLReachable = mysqlReachable(2 * time.Second)
	if s.Store != nil {
		st.HasData, _ = s.Store.HasData(ctx)
	}
	return st, nil
}

// SetupChooseDB 引导选库：必要时起 MySQL、写 .env；驱动变化且 migrate 时拷贝。
func (s *Service) SetupChooseDB(ctx context.Context, driver string, migrate bool) (DBSwitchResult, error) {
	return s.switchDB(ctx, driver, migrate, true)
}

// AdminSwitchDB 设置页切换。
func (s *Service) AdminSwitchDB(ctx context.Context, driver string, migrate bool) (DBSwitchResult, error) {
	return s.switchDB(ctx, driver, migrate, false)
}

// AdminSetSQLitePath 设置页指定 SQLite 文件；migrate 时仅拷入空/新库。
func (s *Service) AdminSetSQLitePath(ctx context.Context, rawPath string, migrate bool) (DBSwitchResult, error) {
	root, err := s.repoRoot()
	if err != nil {
		return DBSwitchResult{}, err
	}
	target, err := dbconfig.NormalizeSQLitePath(rawPath)
	if err != nil {
		return DBSwitchResult{}, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return DBSwitchResult{}, fmt.Errorf("create parent dir: %w", err)
	}
	if !canWriteDir(filepath.Dir(target)) {
		return DBSwitchResult{}, fmt.Errorf("sqlite parent directory is not writable")
	}

	curDriver := dbconfig.NormalizeDriver(s.Cfg.DBDriver)
	curPath := dbconfig.EffectiveSQLitePath(root, curDriver, s.Cfg.DBDSN)
	sameFile := curDriver == dbconfig.DriverSQLite && pathsEqual(curPath, target)

	if migrate {
		if curDriver != dbconfig.DriverSQLite {
			return DBSwitchResult{}, fmt.Errorf("migrate into sqlite path requires current driver to be sqlite")
		}
		if s.Store == nil {
			return DBSwitchResult{}, fmt.Errorf("store not ready")
		}
		has, _ := s.Store.HasData(ctx)
		if !has {
			return DBSwitchResult{}, fmt.Errorf("current database has no data to copy")
		}
		if sameFile {
			return DBSwitchResult{}, fmt.Errorf("target path is already the current database")
		}
		targetHas, err := sqliteFileHasData(ctx, target)
		if err != nil {
			return DBSwitchResult{}, err
		}
		if targetHas {
			return DBSwitchResult{}, fmt.Errorf("target database already has data; refuse overwrite (set migrate=false to use it as-is)")
		}
		if err := s.migrateToSQLitePath(ctx, target); err != nil {
			return DBSwitchResult{}, err
		}
	}

	if err := dbconfig.WriteSQLitePath(root, target); err != nil {
		return DBSwitchResult{}, fmt.Errorf("write .env: %w", err)
	}

	if sameFile && !migrate {
		return DBSwitchResult{
			Driver:  dbconfig.DriverSQLite,
			Restart: "none",
			Command: "./scripts/restart.sh",
			Message: "路径未变化，已确认配置",
		}, nil
	}
	res := applyConfigRestart(root, dbconfig.DriverSQLite)
	if res.Restart == "pending" {
		res.Message = "SQLite 路径已保存，正在重启…"
	} else if res.Restart == "manual" {
		res.Message = "SQLite 路径已保存，请手动执行重启命令"
	} else if res.Restart == "desktop" {
		res.Message = "SQLite 路径已保存，桌面应用即将重启"
	}
	return res, nil
}

func pathsEqual(a, b string) bool {
	a = filepath.Clean(strings.TrimSpace(a))
	b = filepath.Clean(strings.TrimSpace(b))
	return a != "" && a == b
}

// sqliteFileHasData 探测目标文件是否已有业务数据（不存在/空库视为 false）。
func sqliteFileHasData(ctx context.Context, path string) (bool, error) {
	st, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	if st.IsDir() {
		return false, fmt.Errorf("sqlite path is a directory")
	}
	if st.Size() == 0 {
		return false, nil
	}
	db, err := store.NewWithDriver(dbconfig.DriverSQLite, path)
	if err != nil {
		// 无法打开则当作非空/不可用，避免误覆盖
		return true, nil
	}
	defer func() { _ = db.SQLDB().Close() }()
	return db.HasData(ctx)
}

// migrateToSQLitePath 把当前 Store 拷到指定 sqlite 文件。
func (s *Service) migrateToSQLitePath(ctx context.Context, targetDSN string) error {
	if s.Store == nil {
		return fmt.Errorf("store not ready")
	}
	if err := os.MkdirAll(filepath.Dir(targetDSN), 0o755); err != nil {
		return err
	}
	dst, err := store.NewWithDriver(dbconfig.DriverSQLite, targetDSN)
	if err != nil {
		return fmt.Errorf("open target: %w", err)
	}
	defer func() { _ = dst.SQLDB().Close() }()
	return dbmigrate.CopyAll(ctx, s.Store.SQLDB(), dst.SQLDB(), s.Store.Driver(), dbconfig.DriverSQLite, s.Store.Driver(), dbconfig.DriverSQLite)
}

func (s *Service) switchDB(ctx context.Context, driver string, migrate, fromSetup bool) (DBSwitchResult, error) {
	root, err := s.repoRoot()
	if err != nil {
		return DBSwitchResult{}, err
	}
	driver = dbconfig.NormalizeDriver(driver)
	cur := dbconfig.NormalizeDriver(s.Cfg.DBDriver)

	if driver == dbconfig.DriverMySQL {
		if err := ensureDockerMySQL(ctx, root); err != nil {
			return DBSwitchResult{}, err
		}
	}

	needRestart := driver != cur
	if migrate && needRestart {
		if err := s.migrateTo(ctx, root, driver); err != nil {
			return DBSwitchResult{}, err
		}
	}

	if err := dbconfig.WriteDriverChoice(root, driver); err != nil {
		return DBSwitchResult{}, fmt.Errorf("write .env: %w", err)
	}

	if !needRestart {
		res := DBSwitchResult{Driver: driver, Command: "./scripts/restart.sh", Restart: "none"}
		res.Message = "已写入配置（驱动未变）"
		if fromSetup {
			res.Message = "已选择 " + driver
		}
		return res, nil
	}

	return applyConfigRestart(root, driver), nil
}

// migrateTo 从当前 Store 拷到目标驱动默认 DSN。
func (s *Service) migrateTo(ctx context.Context, root, targetDriver string) error {
	if s.Store == nil {
		return fmt.Errorf("store not ready")
	}
	targetDSN := dbconfig.DefaultDSN(root, targetDriver)
	if targetDriver == dbconfig.DriverSQLite {
		if err := os.MkdirAll(filepath.Dir(targetDSN), 0o755); err != nil {
			return err
		}
	}
	dst, err := store.NewWithDriver(targetDriver, targetDSN)
	if err != nil {
		return fmt.Errorf("open target: %w", err)
	}
	defer func() { _ = dst.SQLDB().Close() }()

	srcDB := s.Store.SQLDB()
	dstDB := dst.SQLDB()
	return dbmigrate.CopyAll(ctx, srcDB, dstDB, s.Store.Driver(), targetDriver, s.Store.Driver(), targetDriver)
}

// MigrateProgress 当前迁库进度。
func (s *Service) MigrateProgress() dbmigrate.Progress {
	return dbmigrate.Current()
}

func redactDSNDisplay(driver, dsn string) string {
	if dbconfig.NormalizeDriver(driver) == dbconfig.DriverSQLite {
		return dsn
	}
	at := strings.IndexByte(dsn, '@')
	if at < 0 {
		return dsn
	}
	left := dsn[:at]
	if i := strings.LastIndexByte(left, ':'); i >= 0 {
		left = left[:i+1] + "***"
	}
	return left + dsn[at:]
}

func canWriteDir(dir string) bool {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return false
	}
	p := filepath.Join(dir, ".write_ok")
	f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return false
	}
	_, err = f.Write([]byte("ok"))
	_ = f.Close()
	return err == nil
}

func dockerAvailable() bool {
	_, err := exec.LookPath("docker")
	return err == nil
}

func mysqlReachable(timeout time.Duration) bool {
	conn, err := net.DialTimeout("tcp", "127.0.0.1:3307", timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// ensureDockerMySQL 启动 compose mysql 并等待端口。
func ensureDockerMySQL(ctx context.Context, repoRoot string) error {
	if !dockerAvailable() {
		return fmt.Errorf("未检测到 Docker，请安装 Docker 后重试，或改选 SQLite")
	}
	if mysqlReachable(800 * time.Millisecond) {
		// 再确认能真正连上
		if err := pingMySQL(ctx); err == nil {
			return nil
		}
	}
	cmd := exec.CommandContext(ctx, "docker", "compose", "up", "-d", "mysql")
	cmd.Dir = repoRoot
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker compose up mysql: %w (%s)", err, clipStr(string(out), 400))
	}
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			return err
		}
		if mysqlReachable(500*time.Millisecond) && pingMySQL(ctx) == nil {
			return nil
		}
		time.Sleep(1 * time.Second)
	}
	return fmt.Errorf("MySQL 启动超时（127.0.0.1:3307），请检查 docker compose 日志")
}

func pingMySQL(ctx context.Context) error {
	db, err := sql.Open("mysql", dbconfig.MySQLDefaultDSN())
	if err != nil {
		return err
	}
	defer db.Close()
	cctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	return db.PingContext(cctx)
}

func startRestart(repoRoot string) bool {
	script := filepath.Join(repoRoot, "scripts", "restart.sh")
	if _, err := os.Stat(script); err != nil {
		return false
	}
	// 设置页重启必须脱离当前 HTTP 进程，避免脚本进入前台模式后悬挂。
	cmd := exec.Command("bash", script, "--daemon")
	cmd.Dir = repoRoot
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return false
	}
	// 脱离当前进程生命周期
	_ = cmd.Process.Release()
	return true
}

func clipStr(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
