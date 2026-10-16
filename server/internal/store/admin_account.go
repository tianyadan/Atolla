package store

import (
	"context"
	"database/sql"
	"errors"
)

// AdminAccount 首位管理员（密码只存哈希）。
type AdminAccount struct {
	Username     string
	PasswordHash string
}

// EnsureAdminAccountSchema 创建管理员账号表。
func (s *Store) EnsureAdminAccountSchema(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS admin_account (
		  id            BIGINT       NOT NULL AUTO_INCREMENT,
		  username      VARCHAR(64)  NOT NULL,
		  password_hash VARCHAR(255) NOT NULL,
		  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
		  PRIMARY KEY (id),
		  UNIQUE KEY uk_admin_username (username)
		) ENGINE=InnoDB`)
	return err
}

// GetAdminAccount 返回已注册管理员；尚未注册时 acc 为 nil。
func (s *Store) GetAdminAccount(ctx context.Context) (*AdminAccount, error) {
	var acc AdminAccount
	err := s.db.QueryRowContext(ctx,
		`SELECT username, password_hash FROM admin_account ORDER BY id ASC LIMIT 1`,
	).Scan(&acc.Username, &acc.PasswordHash)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &acc, nil
}

// CreateAdminAccount 写入首位管理员。已有账号时由调用方先判断。
func (s *Store) CreateAdminAccount(ctx context.Context, username, passwordHash string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO admin_account (username, password_hash) VALUES (?, ?)`,
		username, passwordHash)
	return err
}
