package service

import (
	"context"
	"fmt"
	"strconv"

	"atolla/server/internal/dbconfig"
)

const (
	runtimeTTLKey      = "AVATAR_SESSION_WARM_TTL_SEC"
	runtimeMemoryMBKey = "AVATAR_SESSION_WARM_MEMORY_MB"
)

// RuntimeSettings 是设置页可编辑的会话运行时参数。
type RuntimeSettings struct {
	IdleTTLSeconds int    `json:"idle_ttl_seconds"`
	MemoryLimitMB  int    `json:"memory_limit_mb"`
	UpdatePolicy   string `json:"update_policy"`
	RestartCommand string `json:"restart_command"`
}

// GetRuntimeSettings 返回当前进程实际采用的配置。
func (s *Service) GetRuntimeSettings() RuntimeSettings {
	return RuntimeSettings{
		IdleTTLSeconds: s.Cfg.SessionWarmTTLSeconds,
		MemoryLimitMB:  s.Cfg.SessionWarmMemoryMB,
		UpdatePolicy:   "locked",
		RestartCommand: "./scripts/restart.sh --daemon",
	}
}

// SaveRuntimeSettings 写入 .env；配置在用户点击重启后生效。
func (s *Service) SaveRuntimeSettings(_ context.Context, in RuntimeSettings) (RuntimeSettings, error) {
	if err := validateRuntimeSettings(in); err != nil {
		return RuntimeSettings{}, err
	}
	root, err := s.repoRoot()
	if err != nil {
		return RuntimeSettings{}, err
	}
	if err := dbconfig.UpsertEnvKeys(dbconfig.EnvPath(root), map[string]string{
		runtimeTTLKey:      strconv.Itoa(in.IdleTTLSeconds),
		runtimeMemoryMBKey: strconv.Itoa(in.MemoryLimitMB),
	}); err != nil {
		return RuntimeSettings{}, fmt.Errorf("保存运行时配置: %w", err)
	}
	return RuntimeSettings{
		IdleTTLSeconds: in.IdleTTLSeconds,
		MemoryLimitMB:  in.MemoryLimitMB,
		UpdatePolicy:   "locked",
		RestartCommand: "./scripts/restart.sh --daemon",
	}, nil
}

func validateRuntimeSettings(in RuntimeSettings) error {
	if in.IdleTTLSeconds < 0 || in.IdleTTLSeconds > 3600 {
		return fmt.Errorf("保温时长需在 0 到 3600 秒之间")
	}
	if in.MemoryLimitMB < 128 || in.MemoryLimitMB > 32768 {
		return fmt.Errorf("内存阈值需在 128 到 32768 MB 之间")
	}
	return nil
}

// RestartRuntime 使用仓库既有脚本异步重启，避免设置页自行拼接 kill 命令。
func (s *Service) RestartRuntime() error {
	root, err := s.repoRoot()
	if err != nil {
		return err
	}
	if !startRestart(root) {
		return fmt.Errorf("无法启动重启脚本，请手动执行 ./scripts/restart.sh --daemon")
	}
	return nil
}
