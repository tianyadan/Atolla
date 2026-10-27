package dbconfig

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	DriverSQLite = "sqlite"
	DriverMySQL  = "mysql"

	EnvDriver = "AVATAR_DB_DRIVER"
	EnvDSN    = "AVATAR_DB_DSN"
	EnvChosen = "AVATAR_DB_CHOSEN" // 1=用户已在引导/设置中确认过驱动
)

// MySQLDefaultDSN 本机 Docker compose 默认连接串。
func MySQLDefaultDSN() string {
	return "root:root@tcp(127.0.0.1:3307)/colleague_avatar?parseTime=true&charset=utf8mb4&loc=Local"
}

// SQLiteDSN 返回仓库根下 data/atolla.db 的绝对路径。
func SQLiteDSN(repoRoot string) string {
	return filepath.Join(repoRoot, "data", "atolla.db")
}

// DefaultDSN 按驱动返回默认 DSN。
func DefaultDSN(repoRoot, driver string) string {
	if NormalizeDriver(driver) == DriverMySQL {
		return MySQLDefaultDSN()
	}
	return SQLiteDSN(repoRoot)
}

// NormalizeDriver 规范化驱动名。
func NormalizeDriver(d string) string {
	switch strings.ToLower(strings.TrimSpace(d)) {
	case DriverSQLite, "sqlite3":
		return DriverSQLite
	default:
		return DriverMySQL
	}
}

// RepoRoot 从 cwd 向上找含 docker-compose.yml 与 scripts/start.sh 的目录。
func RepoRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	dir := wd
	for {
		if fileExists(filepath.Join(dir, "docker-compose.yml")) &&
			fileExists(filepath.Join(dir, "scripts", "start.sh")) {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	// 兼容 cwd=server/
	if fileExists(filepath.Join(wd, "..", "docker-compose.yml")) {
		return filepath.Clean(filepath.Join(wd, "..")), nil
	}
	return "", fmt.Errorf("cannot find Atolla repo root from %s", wd)
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// EnvPath 仓库根 .env 路径。
func EnvPath(repoRoot string) string {
	return filepath.Join(repoRoot, ".env")
}

// ReadEnvFile 解析 .env 为 key→value（忽略注释与空行；不处理 export 前缀以外的复杂语法）。
func ReadEnvFile(path string) (map[string]string, error) {
	out := map[string]string{}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return nil, err
	}
	for _, line := range strings.Split(string(b), "\n") {
		s := strings.TrimSpace(line)
		if s == "" || strings.HasPrefix(s, "#") {
			continue
		}
		s = strings.TrimPrefix(s, "export ")
		i := strings.IndexByte(s, '=')
		if i <= 0 {
			continue
		}
		k := strings.TrimSpace(s[:i])
		v := strings.TrimSpace(s[i+1:])
		v = strings.Trim(v, `"'`)
		out[k] = v
	}
	return out, nil
}

// UpsertEnvKeys 更新或追加键；保留其它行与注释。
func UpsertEnvKeys(path string, kv map[string]string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	var lines []string
	seen := map[string]bool{}
	if b, err := os.ReadFile(path); err == nil {
		lines = strings.Split(string(b), "\n")
		// 去掉末尾多余空行，后面统一处理
		for len(lines) > 0 && lines[len(lines)-1] == "" {
			lines = lines[:len(lines)-1]
		}
	} else if !os.IsNotExist(err) {
		return err
	}

	writeLine := func(k, v string) string {
		if strings.ContainsAny(v, " \t#\"'") || strings.Contains(v, "\n") {
			return fmt.Sprintf("%s=%q", k, v)
		}
		return k + "=" + v
	}

	for i, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "#") {
			continue
		}
		raw := strings.TrimPrefix(trim, "export ")
		eq := strings.IndexByte(raw, '=')
		if eq <= 0 {
			continue
		}
		k := strings.TrimSpace(raw[:eq])
		if nv, ok := kv[k]; ok {
			prefix := ""
			if strings.HasPrefix(strings.TrimSpace(line), "export ") {
				prefix = "export "
			}
			lines[i] = prefix + writeLine(k, nv)
			seen[k] = true
		}
	}
	for k, v := range kv {
		if seen[k] {
			continue
		}
		lines = append(lines, writeLine(k, v))
	}
	content := strings.Join(lines, "\n")
	if !strings.HasSuffix(content, "\n") {
		content += "\n"
	}
	return os.WriteFile(path, []byte(content), 0o600)
}

// WriteDriverChoice 写入驱动与 DSN，并标记已选择。
func WriteDriverChoice(repoRoot, driver string) error {
	driver = NormalizeDriver(driver)
	dsn := DefaultDSN(repoRoot, driver)
	if driver == DriverSQLite {
		if err := os.MkdirAll(filepath.Dir(dsn), 0o755); err != nil {
			return err
		}
	}
	return UpsertEnvKeys(EnvPath(repoRoot), map[string]string{
		EnvDriver: driver,
		EnvDSN:    dsn,
		EnvChosen: "1",
	})
}

// Chosen 用户是否已确认过数据库选择。
func Chosen(repoRoot string) bool {
	m, err := ReadEnvFile(EnvPath(repoRoot))
	if err != nil {
		return false
	}
	return m[EnvChosen] == "1" || strings.EqualFold(m[EnvChosen], "true")
}
