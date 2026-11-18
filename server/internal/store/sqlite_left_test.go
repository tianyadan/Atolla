package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

// TestLeftNullReturnsSQLNull 对齐 MySQL：LEFT(NULL,n) 必须是 SQL NULL，不能是 "<nil>" 字符串。
func TestLeftNullReturnsSQLNull(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "left.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.SQLDB().Close()

	var s sql.NullString
	if err := st.SQLDB().QueryRow(`SELECT LEFT(NULL, 80)`).Scan(&s); err != nil {
		t.Fatal(err)
	}
	if s.Valid {
		t.Fatalf("LEFT(NULL) want SQL NULL, got %q", s.String)
	}

	var title string
	if err := st.SQLDB().QueryRow(
		`SELECT COALESCE(NULLIF(LEFT(NULL,80),''), '新对话')`,
	).Scan(&title); err != nil {
		t.Fatal(err)
	}
	if title != "新对话" {
		t.Fatalf("fallback title=%q", title)
	}
}

// TestRepairSQLiteTextAffinity 把 BLOB 形态的 role 修回 TEXT，使 role='user' 可匹配。
func TestRepairSQLiteTextAffinity(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "repair.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.SQLDB().Close()
	db := st.SQLDB()
	// role/content 以 BLOB 写入，模拟 MySQL→SQLite 迁库污染
	_, err = db.Exec(`
		INSERT INTO messages (conversation_id, role, content, status)
		VALUES (1, X'75736572', CAST('你好世界' AS BLOB), 'ok')`)
	if err != nil {
		t.Fatal(err)
	}

	var n int
	if err := db.QueryRow(`SELECT COUNT(*) FROM messages WHERE role='user'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("before repair role='user' should miss blob rows, got %d", n)
	}

	if err := st.repairSQLiteTextAffinity(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM messages WHERE role='user'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("after repair want 1, got %d", n)
	}
	var typ string
	if err := db.QueryRow(`SELECT typeof(role) FROM messages LIMIT 1`).Scan(&typ); err != nil {
		t.Fatal(err)
	}
	if typ != "text" {
		t.Fatalf("typeof(role)=%s", typ)
	}
}

// TestRepairSQLiteTextAffinityDedupePK 迁库后同一主键 TEXT+BLOB 双行时，repair 应去重而非 UNIQUE 失败。
func TestRepairSQLiteTextAffinityDedupePK(t *testing.T) {
	st, err := NewWithDriver(DriverSQLite, filepath.Join(t.TempDir(), "repair-pk.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.SQLDB().Close()
	db := st.SQLDB()

	// 模拟 app_settings：同键一条 TEXT、一条 BLOB（SQLite 视作不同主键）
	_, err = db.Exec(`DELETE FROM app_settings`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO app_settings (k, v) VALUES ('notify_task_done', '1')`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO app_settings (k, v) VALUES (X'6E6F746966795F7461736B5F646F6E65', X'31')`)
	if err != nil {
		t.Fatal(err)
	}
	var before int
	if err := db.QueryRow(`SELECT COUNT(*) FROM app_settings`).Scan(&before); err != nil || before != 2 {
		t.Fatalf("before rows=%d err=%v", before, err)
	}

	if err := st.repairSQLiteTextAffinity(context.Background()); err != nil {
		t.Fatalf("repair: %v", err)
	}
	var after int
	if err := db.QueryRow(`SELECT COUNT(*) FROM app_settings`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != 1 {
		t.Fatalf("after dedupe want 1 row, got %d", after)
	}
	var typ, k, v string
	if err := db.QueryRow(`SELECT typeof(k), k, v FROM app_settings`).Scan(&typ, &k, &v); err != nil {
		t.Fatal(err)
	}
	if typ != "text" || k != "notify_task_done" || v != "1" {
		t.Fatalf("got typeof=%s k=%q v=%q", typ, k, v)
	}
}
