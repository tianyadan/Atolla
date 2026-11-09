package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	sqlite "modernc.org/sqlite"
)

// Driver 平台主库驱动。
const (
	DriverMySQL  = "mysql"
	DriverSQLite = "sqlite"
)

func init() {
	// SQLite 兼容 MySQL 常用函数，降低业务 SQL 改写面。
	sqlite.MustRegisterScalarFunction("now", 0, func(ctx *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		// SQLite DATETIME 会按 UTC 扫入 time.Time；这里也必须写 UTC，
		// 否则东八区本地墙上时间会被误读成未来 8 小时，运行计时一直停在 0。
		return time.Now().UTC().Format("2006-01-02 15:04:05.000"), nil
	})
	sqlite.MustRegisterDeterministicScalarFunction("unix_timestamp", -1, func(ctx *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		if len(args) == 0 || args[0] == nil {
			return time.Now().Unix(), nil
		}
		switch v := args[0].(type) {
		case time.Time:
			return v.Unix(), nil
		case string:
			s := strings.TrimSpace(v)
			if s == "" {
				return int64(0), nil
			}
			for _, layout := range []string{
				"2006-01-02 15:04:05.000",
				"2006-01-02 15:04:05",
				time.RFC3339,
			} {
				if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
					return t.Unix(), nil
				}
			}
			return int64(0), nil
		case int64:
			return v, nil
		case float64:
			return int64(v), nil
		default:
			return int64(0), nil
		}
	})
	// LEFT 对齐 MySQL：LEFT(NULL,n) → NULL（勿用 fmt.Sprint(nil) 变成字面量 "<nil>"）
	sqlite.MustRegisterDeterministicScalarFunction("left", 2, func(ctx *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		if len(args) < 2 || args[0] == nil {
			return nil, nil
		}
		s, ok := valueAsString(args[0])
		if !ok {
			return nil, nil
		}
		n := toInt(args[1])
		if n <= 0 {
			return "", nil
		}
		r := []rune(s)
		if n >= len(r) {
			return s, nil
		}
		return string(r[:n]), nil
	})
	sqlite.MustRegisterDeterministicScalarFunction("if", 3, func(ctx *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
		if truthy(args[0]) {
			return args[1], nil
		}
		return args[2], nil
	})
}

func toInt(v driver.Value) int {
	switch t := v.(type) {
	case int64:
		return int(t)
	case float64:
		return int(t)
	case string:
		n, _ := strconv.Atoi(t)
		return n
	case []byte:
		n, _ := strconv.Atoi(string(t))
		return n
	default:
		return 0
	}
}

/** valueAsString 把 SQL 驱动值收成字符串；nil 返回 ok=false。 */
func valueAsString(v driver.Value) (string, bool) {
	switch t := v.(type) {
	case nil:
		return "", false
	case string:
		return t, true
	case []byte:
		if t == nil {
			return "", false
		}
		return string(t), true
	default:
		// 避免 fmt.Sprint(nil) → "<nil>"；其余类型再 Sprint
		return fmt.Sprint(t), true
	}
}

func truthy(v driver.Value) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case int64:
		return t != 0
	case float64:
		return t != 0
	case string:
		s := strings.ToLower(strings.TrimSpace(t))
		return s != "" && s != "0" && s != "false"
	default:
		return true
	}
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

// IsSQLite 当前是否 SQLite。
func (s *Store) IsSQLite() bool { return s != nil && s.driver == DriverSQLite }

// IsMySQL 当前是否 MySQL。
func (s *Store) IsMySQL() bool { return s == nil || s.driver == DriverMySQL }

// openDB 按驱动打开连接。
func openDB(driver, dsn string) (*sql.DB, error) {
	driver = NormalizeDriver(driver)
	switch driver {
	case DriverSQLite:
		path := strings.TrimSpace(dsn)
		if path == "" {
			path = "./data/atolla.db"
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil && filepath.Dir(path) != "." {
			return nil, err
		}
		// modernc 驱动名是 "sqlite"
		uri := path
		if !strings.HasPrefix(path, "file:") {
			// _texttotime：DATETIME 列 TEXT 值扫入 time.Time；_time_format=sqlite：写入格式兼容 CURRENT_TIMESTAMP
			uri = "file:" + path + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_texttotime=1&_time_format=sqlite"
		}
		db, err := sql.Open("sqlite", uri)
		if err != nil {
			return nil, err
		}
		db.SetMaxOpenConns(1) // SQLite 单写者更稳
		db.SetMaxIdleConns(1)
		if err := db.Ping(); err != nil {
			_ = db.Close()
			return nil, err
		}
		return db, nil
	default:
		db, err := sql.Open("mysql", dsn)
		if err != nil {
			return nil, err
		}
		db.SetMaxOpenConns(10)
		db.SetMaxIdleConns(5)
		if err := db.Ping(); err != nil {
			_ = db.Close()
			return nil, err
		}
		return db, nil
	}
}

// hasTable 表是否存在。
func (s *Store) hasTable(ctx context.Context, table string) (bool, error) {
	if s.IsSQLite() {
		var n int
		err := s.db.QueryRowContext(ctx,
			`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&n)
		return n > 0, err
	}
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.TABLES
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, table).Scan(&n)
	return n > 0, err
}

// hasColumn 列是否存在。
func (s *Store) hasColumn(ctx context.Context, table, column string) (bool, error) {
	if s.IsSQLite() {
		rows, err := s.db.QueryContext(ctx, `PRAGMA table_info(`+quoteIdent(table)+`)`)
		if err != nil {
			return false, err
		}
		defer rows.Close()
		for rows.Next() {
			var cid int
			var name, ctype string
			var notnull, pk int
			var dflt sql.NullString
			if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
				return false, err
			}
			if strings.EqualFold(name, column) {
				return true, nil
			}
		}
		return false, rows.Err()
	}
	var n int
	err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM information_schema.COLUMNS
		 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
		table, column).Scan(&n)
	return n > 0, err
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

var (
	reEngineInno  = regexp.MustCompile(`(?i)\s*ENGINE\s*=\s*InnoDB[^;\n]*`)
	reAutoInc     = regexp.MustCompile(`(?i)\bAUTO_INCREMENT\b`)
	reAfterCol    = regexp.MustCompile(`(?i)\s+AFTER\s+[a-zA-Z0-9_]+`)
	reOnUpdate    = regexp.MustCompile(`(?i)\s+ON UPDATE CURRENT_TIMESTAMP(?:\(\d+\))?`)
	reTinyInt     = regexp.MustCompile(`(?i)\bTINYINT(?:\(\d+\))?`)
	reBigInt      = regexp.MustCompile(`(?i)\bBIGINT(?:\(\d+\))?`)
	reIntType     = regexp.MustCompile(`(?i)\bINT(?:\(\d+\))?\b`)
	reDouble      = regexp.MustCompile(`(?i)\bDOUBLE(?:\s+PRECISION)?\b`)
	reLongText    = regexp.MustCompile(`(?i)\bLONGTEXT\b`)
	reJSONType    = regexp.MustCompile(`(?i)\bJSON\b`)
	reDateTime    = regexp.MustCompile(`(?i)\bDATETIME(?:\(\d+\))?`)
	reCharset     = regexp.MustCompile(`(?i)\s*DEFAULT CHARSET\s*=\s*\w+`)
	reEnum        = regexp.MustCompile(`(?i)\bENUM\s*\([^)]*\)`)
	reUniqueKey = regexp.MustCompile(`(?i),?\s*UNIQUE\s+KEY\s+\w+\s*\(([^)]+)\)`)
	// \b 避免把 source_key / idempotency_key 列名里的 key 当成 MySQL KEY 索引语法吃掉。
	reKeyIdx     = regexp.MustCompile(`(?i),?\s*\b(?:KEY|INDEX)\s+\w+\s*\([^)]+\)`)
	reConstraint = regexp.MustCompile(`(?i),?\s*(?:CONSTRAINT\s+\w+\s+)?FOREIGN KEY\s*\([^)]+\)\s*REFERENCES\s+\w+\s*\([^)]+\)(?:\s+ON DELETE\s+\w+(?:\s+\w+)?)?(?:\s+ON UPDATE\s+\w+(?:\s+\w+)?)?`)
	reIdPKLine   = regexp.MustCompile(`(?i)\bid\s+INTEGER\s+NOT NULL\s*,`)
	rePrimaryId  = regexp.MustCompile(`(?i),?\s*PRIMARY KEY\s*\(\s*id\s*\)`)
	reIdxPrefix  = regexp.MustCompile(`(?i)(\w+)\((\d+)\)`)
)

// 索引列前缀长度（非类型）：path(255) / command_signature(191)
var reIndexColPrefix = regexp.MustCompile(`(?i)\b(path|url|workspace_path|command_signature|name|pattern)\(\d+\)`)

// toSQLiteDDL 将常见 MySQL DDL 降级为 SQLite 可执行语句。
func toSQLiteDDL(ddl string) string {
	s := ddl
	s = reEngineInno.ReplaceAllString(s, "")
	s = reCharset.ReplaceAllString(s, "")
	s = reOnUpdate.ReplaceAllString(s, "")
	s = reAfterCol.ReplaceAllString(s, "")
	s = reConstraint.ReplaceAllString(s, "")
	// 先去掉索引列前缀长度，避免 KEY (... col(191)) 嵌套括号截断
	s = reIndexColPrefix.ReplaceAllString(s, "$1")
	// UNIQUE KEY name (a,b) → UNIQUE(a,b)；普通 KEY/INDEX 删除
	s = reUniqueKey.ReplaceAllStringFunc(s, func(m string) string {
		sub := reUniqueKey.FindStringSubmatch(m)
		if len(sub) < 2 {
			return ""
		}
		return ", UNIQUE(" + sub[1] + ")"
	})
	s = reKeyIdx.ReplaceAllString(s, "")
	s = reAutoInc.ReplaceAllString(s, "")
	s = reEnum.ReplaceAllString(s, "TEXT")
	s = reTinyInt.ReplaceAllString(s, "INTEGER")
	s = reBigInt.ReplaceAllString(s, "INTEGER")
	s = reIntType.ReplaceAllString(s, "INTEGER")
	s = reDouble.ReplaceAllString(s, "REAL")
	s = reLongText.ReplaceAllString(s, "TEXT")
	s = reJSONType.ReplaceAllString(s, "TEXT")
	// 保留 DATETIME 声明类型，配合 DSN _texttotime 扫入 time.Time
	s = reDateTime.ReplaceAllString(s, "DATETIME")
	s = strings.ReplaceAll(s, "CURRENT_TIMESTAMP(3)", "CURRENT_TIMESTAMP")
	s = regexp.MustCompile(`(?i)\s+COMMENT\s+'[^']*'`).ReplaceAllString(s, "")
	// id INTEGER PRIMARY KEY AUTOINCREMENT
	if rePrimaryId.MatchString(s) {
		s = reIdPKLine.ReplaceAllString(s, "id INTEGER PRIMARY KEY AUTOINCREMENT,")
		s = rePrimaryId.ReplaceAllString(s, "")
	}
	s = regexp.MustCompile(`,\s*,`).ReplaceAllString(s, ",")
	s = regexp.MustCompile(`,\s*\)`).ReplaceAllString(s, ")")
	return s
}

// execDDL 执行建表/改表 DDL（按驱动改写）。
func (s *Store) execDDL(ctx context.Context, ddl string) error {
	q := ddl
	if s.IsSQLite() {
		q = toSQLiteDDL(ddl)
		// SQLite 不支持 MODIFY COLUMN
		if strings.Contains(strings.ToUpper(q), "MODIFY COLUMN") {
			return nil
		}
	}
	_, err := s.db.ExecContext(ctx, q)
	return err
}

// addColumnIfMissing 若列不存在则执行 ADD COLUMN DDL。
func (s *Store) addColumnIfMissing(ctx context.Context, table, column, ddl string) error {
	ok, err := s.hasColumn(ctx, table, column)
	if err != nil || ok {
		return err
	}
	return s.execDDL(ctx, ddl)
}

// castCharExpr 将 JSON/文本列转为字符串的方言表达式。
func (s *Store) castCharExpr(col string) string {
	if s.IsSQLite() {
		return "CAST(" + col + " AS TEXT)"
	}
	return "CAST(" + col + " AS CHAR)"
}

// jsonParam 写入 JSON 列的占位符：MySQL 用 CAST(? AS JSON)，SQLite 存 TEXT 用 ?。
func (s *Store) jsonParam() string {
	if s.IsSQLite() {
		return "?"
	}
	return "CAST(? AS JSON)"
}

// jsonColAssign 生成 col=CAST(? AS JSON) / col=? 赋值片段。
func (s *Store) jsonColAssign(col string) string {
	return col + "=" + s.jsonParam()
}

// tsNow 高精度时间戳表达式（SQLite 无 CURRENT_TIMESTAMP(3)）。
func (s *Store) tsNow() string {
	if s.IsSQLite() {
		return "CURRENT_TIMESTAMP"
	}
	return "CURRENT_TIMESTAMP(3)"
}

// insertIgnore INSERT IGNORE（MySQL）/ INSERT OR IGNORE（SQLite）。
func (s *Store) insertIgnore() string {
	if s.IsSQLite() {
		return "INSERT OR IGNORE"
	}
	return "INSERT IGNORE"
}

// insertOnConflictDoNothing 插入；冲突则忽略（种子数据常用）。
func (s *Store) insertOnConflictDoNothing(tableCols, valuesSQL, conflictCols string) string {
	if s.IsSQLite() {
		return fmt.Sprintf(`INSERT INTO %s VALUES %s ON CONFLICT(%s) DO NOTHING`, tableCols, valuesSQL, conflictCols)
	}
	col := strings.TrimSpace(strings.Split(conflictCols, ",")[0])
	return fmt.Sprintf(`INSERT INTO %s VALUES %s ON DUPLICATE KEY UPDATE %s=VALUES(%s)`, tableCols, valuesSQL, col, col)
}

// insertOnConflictUpdate 冲突时更新指定列（updateSet 不含 SET 关键字）。
// mysqlUpdate 用 VALUES(col)；sqliteUpdate 用 excluded.col。
func (s *Store) insertOnConflictUpdate(tableCols, valuesSQL, conflictCols, mysqlUpdate, sqliteUpdate string) string {
	if s.IsSQLite() {
		return fmt.Sprintf(`INSERT INTO %s VALUES %s ON CONFLICT(%s) DO UPDATE SET %s`, tableCols, valuesSQL, conflictCols, sqliteUpdate)
	}
	return fmt.Sprintf(`INSERT INTO %s VALUES %s ON DUPLICATE KEY UPDATE %s`, tableCols, valuesSQL, mysqlUpdate)
}
