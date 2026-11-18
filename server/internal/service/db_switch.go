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
	Driver          string `json:"driver"`
	DSNDisplay      string `json:"dsn_display"`
	Chosen          bool   `json:"chosen"`
	SQLitePath      string `json:"sqlite_path"`
	SQLiteWritable  bool   `json:"sqlite_writable"`
	DockerAvailable bool   `json:"docker_available"`
	MySQLReachable  bool   `json:"mysql_reachable"`
	HasData         bool   `json:"has_data"`
	OtherHasData    bool   `json:"other_has_data,omitempty"`
	Migrate         dbmigrate.Progress `json:"migrate"`
	RestartCommand  string `json:"restart_command"`
}

// DBSwitchReq 切换请求。
type DBSwitchReq struct {
	Driver  string `json:"driver"`
	Migrate bool   `json:"migrate"`
}

// DBSwitchResult 切换结果。
type DBSwitchResult struct {
	Driver  string `json:"driver"`
	Restart string `json:"restart"` // pending | manual | none
	Command string `json:"command"`
	Message string `json:"message,omitempty"`
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
	st := DBStatus{
		Driver:         driver,
		DSNDisplay:     redactDSNDisplay(driver, s.Cfg.DBDSN),
		Chosen:         dbconfig.Chosen(root),
		SQLitePath:     dbconfig.SQLiteDSN(root),
		RestartCommand: "./scripts/restart.sh",
		Migrate:        dbmigrate.Current(),
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

func (s *Service) switchDB(ctx context.Context, driver string, migrate, fromSetup bool) (DBSwitchResult, error) {
	root, err := s.repoRoot()
	if err != nil {
		return DBSwitchResult{}, err
	}
	driver = dbconfig.NormalizeDriver(driver)
	cur := dbconfig.NormalizeDriver(s.Cfg.DBDriver)
	cmd := "./scripts/restart.sh"

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

	res := DBSwitchResult{Driver: driver, Command: cmd, Restart: "none"}
	if !needRestart {
		res.Message = "已写入配置（驱动未变）"
		if fromSetup {
			res.Message = "已选择 " + driver
		}
		return res, nil
	}

	if startRestart(root) {
		res.Restart = "pending"
		res.Message = "配置已保存，正在重启…"
	} else {
		res.Restart = "manual"
		res.Message = "配置已保存，请手动执行重启命令"
	}
	return res, nil
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
