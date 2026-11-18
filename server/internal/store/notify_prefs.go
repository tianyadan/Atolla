package store

import "context"

// NotifyPrefs 电脑端通知开关。新实例默认关闭，开启前需 Bark 验证。
type NotifyPrefs struct {
	TaskDone     bool `json:"task_done"`
	Permission   bool `json:"permission"`
	BarkVerified bool `json:"bark_verified"`
}

const (
	notifyPrefTaskDone      = "notify_task_done"
	notifyPrefPermission    = "notify_permission"
	notifyPrefBarkVerified  = "notify_bark_verified"
)

// EnsureNotifyPrefsSchema 创建实例级键值表；新实例种子为关闭，已有数据不覆盖。
func (s *Store) EnsureNotifyPrefsSchema(ctx context.Context) error {
	if err := s.execDDL(ctx, `
		CREATE TABLE IF NOT EXISTS app_settings (
		  k          VARCHAR(64)  NOT NULL,
		  v          VARCHAR(255) NOT NULL,
		  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		  PRIMARY KEY (k)
		) ENGINE=InnoDB`); err != nil {
		return err
	}
	q := s.insertOnConflictDoNothing(
		`app_settings (k, v)`,
		`(?, '0'), (?, '0'), (?, '0')`,
		`k`,
	)
	if _, err := s.db.ExecContext(ctx, q, notifyPrefTaskDone, notifyPrefPermission, notifyPrefBarkVerified); err != nil {
		return err
	}
	// 已开启任一通知的旧实例视为已验证，避免升级后被锁死。
	var onCount int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM app_settings WHERE k IN (?, ?) AND v != '0'`,
		notifyPrefTaskDone, notifyPrefPermission,
	).Scan(&onCount); err != nil {
		return err
	}
	if onCount == 0 {
		return nil
	}
	_, err := s.upsertNotifyPref(ctx, notifyPrefBarkVerified, true)
	return err
}

// GetNotifyPrefs 读取完成通知、命令审批通知与 Bark 验证状态。缺行时开关默认关、未验证。
func (s *Store) GetNotifyPrefs(ctx context.Context) (NotifyPrefs, error) {
	out := NotifyPrefs{}
	rows, err := s.db.QueryContext(ctx,
		`SELECT k, v FROM app_settings WHERE k IN (?, ?, ?)`,
		notifyPrefTaskDone, notifyPrefPermission, notifyPrefBarkVerified)
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
		case notifyPrefBarkVerified:
			out.BarkVerified = on
		}
	}
	return out, rows.Err()
}

// SaveNotifyPrefs 写入两条通知开关（不改 bark_verified）。
func (s *Store) SaveNotifyPrefs(ctx context.Context, p NotifyPrefs) error {
	if _, err := s.upsertNotifyPref(ctx, notifyPrefTaskDone, p.TaskDone); err != nil {
		return err
	}
	_, err := s.upsertNotifyPref(ctx, notifyPrefPermission, p.Permission)
	return err
}

// SetBarkVerified 写入 Bark 可达性验证标记。
func (s *Store) SetBarkVerified(ctx context.Context, ok bool) error {
	_, err := s.upsertNotifyPref(ctx, notifyPrefBarkVerified, ok)
	return err
}

func (s *Store) upsertNotifyPref(ctx context.Context, key string, on bool) (int64, error) {
	v := "0"
	if on {
		v = "1"
	}
	q := s.insertOnConflictUpdate(
		`app_settings (k, v)`,
		`(?, ?)`,
		`k`,
		`v = VALUES(v)`,
		`v = excluded.v`,
	)
	res, err := s.db.ExecContext(ctx, q, key, v)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
