package store

import "context"

// NotifyPrefs 电脑端通知开关。缺省都打开。
type NotifyPrefs struct {
	TaskDone   bool `json:"task_done"`
	Permission bool `json:"permission"`
}

const (
	notifyPrefTaskDone   = "notify_task_done"
	notifyPrefPermission = "notify_permission"
)

// EnsureNotifyPrefsSchema 创建实例级键值表，并种子两条通知开关（默认开启）。
func (s *Store) EnsureNotifyPrefsSchema(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS app_settings (
		  k          VARCHAR(64)  NOT NULL,
		  v          VARCHAR(255) NOT NULL,
		  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		  PRIMARY KEY (k)
		) ENGINE=InnoDB`); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO app_settings (k, v) VALUES
		  (?, '1'),
		  (?, '1')
		ON DUPLICATE KEY UPDATE k = k`,
		notifyPrefTaskDone, notifyPrefPermission)
	return err
}

// GetNotifyPrefs 读取完成通知与命令审批通知开关。缺行时视为开启。
func (s *Store) GetNotifyPrefs(ctx context.Context) (NotifyPrefs, error) {
	out := NotifyPrefs{TaskDone: true, Permission: true}
	rows, err := s.db.QueryContext(ctx,
		`SELECT k, v FROM app_settings WHERE k IN (?, ?)`,
		notifyPrefTaskDone, notifyPrefPermission)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return out, err
		}
		on := v != "0"
		switch k {
		case notifyPrefTaskDone:
			out.TaskDone = on
		case notifyPrefPermission:
			out.Permission = on
		}
	}
	return out, rows.Err()
}

// SaveNotifyPrefs 写入两条通知开关。
func (s *Store) SaveNotifyPrefs(ctx context.Context, p NotifyPrefs) error {
	if _, err := s.upsertNotifyPref(ctx, notifyPrefTaskDone, p.TaskDone); err != nil {
		return err
	}
	_, err := s.upsertNotifyPref(ctx, notifyPrefPermission, p.Permission)
	return err
}

func (s *Store) upsertNotifyPref(ctx context.Context, key string, on bool) (int64, error) {
	v := "0"
	if on {
		v = "1"
	}
	res, err := s.db.ExecContext(ctx, `
		INSERT INTO app_settings (k, v) VALUES (?, ?)
		ON DUPLICATE KEY UPDATE v = VALUES(v)`, key, v)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
