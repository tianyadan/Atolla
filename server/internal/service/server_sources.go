package service

import (
	"context"
	"fmt"
	"strings"

	"atolla/server/internal/permission"
	"atolla/server/internal/store"
	"atolla/server/internal/testsrv"
)

const skillServerControlID = "atolla.server_control"

// ListAgentServerSources lists SSH servers for an agent.
func (s *Service) ListAgentServerSources(ctx context.Context, agentID int64) ([]store.ServerSource, error) {
	if err := s.requireServerSkill(ctx, agentID); err != nil {
		return nil, err
	}
	items, err := s.Store.ListServerSources(ctx, agentID)
	if err != nil {
		return nil, err
	}
	for i := range items {
		items[i].PasswordEnc = ""
	}
	return items, nil
}

// CreateAgentServerSource creates + optional auto test.
func (s *Service) CreateAgentServerSource(ctx context.Context, agentID int64, in store.ServerSourceInput, autoTest bool) (store.ServerSource, error) {
	if err := s.requireServerSkill(ctx, agentID); err != nil {
		return store.ServerSource{}, err
	}
	enc := ""
	if strings.TrimSpace(in.Password) != "" {
		var err error
		enc, err = testsrv.EncryptPassword(s.Cfg.SecretKey, in.Password)
		if err != nil {
			return store.ServerSource{}, fmt.Errorf("encrypt password: %w", err)
		}
	}
	src, err := s.Store.CreateServerSource(ctx, agentID, in, enc)
	if err != nil {
		return src, err
	}
	if autoTest && enc != "" {
		src, _ = s.TestAgentServerSource(ctx, agentID, src.ID)
		return src, nil
	}
	src.PasswordEnc = ""
	return src, nil
}

// UpdateAgentServerSource updates a server.
func (s *Service) UpdateAgentServerSource(ctx context.Context, agentID, id int64, in store.ServerSourceInput) (store.ServerSource, error) {
	if err := s.requireServerSkill(ctx, agentID); err != nil {
		return store.ServerSource{}, err
	}
	var passEnc *string
	if in.ClearPassword {
		empty := ""
		passEnc = &empty
	} else if strings.TrimSpace(in.Password) != "" {
		enc, err := testsrv.EncryptPassword(s.Cfg.SecretKey, in.Password)
		if err != nil {
			return store.ServerSource{}, fmt.Errorf("encrypt password: %w", err)
		}
		passEnc = &enc
	}
	src, err := s.Store.UpdateServerSource(ctx, agentID, id, in, passEnc)
	if err != nil {
		return src, err
	}
	src.PasswordEnc = ""
	return src, nil
}

// DeleteAgentServerSource removes a server.
func (s *Service) DeleteAgentServerSource(ctx context.Context, agentID, id int64) error {
	if err := s.requireServerSkill(ctx, agentID); err != nil {
		return err
	}
	return s.Store.DeleteServerSource(ctx, agentID, id)
}

// TestAgentServerSource SSHs with `true` to verify credentials.
func (s *Service) TestAgentServerSource(ctx context.Context, agentID, id int64) (store.ServerSource, error) {
	if err := s.requireServerSkill(ctx, agentID); err != nil {
		return store.ServerSource{}, err
	}
	src, err := s.Store.GetServerSource(ctx, agentID, id)
	if err != nil {
		return src, err
	}
	if strings.TrimSpace(src.PasswordEnc) == "" {
		_ = s.Store.SetServerSourceTestResult(ctx, agentID, id, false, "未设置密码")
		return s.reloadServerPublic(ctx, agentID, id)
	}
	pass, err := testsrv.DecryptPassword(s.Cfg.SecretKey, src.PasswordEnc)
	if err != nil {
		_ = s.Store.SetServerSourceTestResult(ctx, agentID, id, false, "解密密码失败")
		return s.reloadServerPublic(ctx, agentID, id)
	}
	_, stderr, runErr := testsrv.RunSSH(src.Host, src.Port, src.Username, pass, "true", s.Cfg.SSHInsecureIgnoreHostKey)
	if runErr != nil {
		msg := runErr.Error()
		if strings.TrimSpace(stderr) != "" {
			msg = msg + ": " + strings.TrimSpace(stderr)
		}
		_ = s.Store.SetServerSourceTestResult(ctx, agentID, id, false, msg)
		return s.reloadServerPublic(ctx, agentID, id)
	}
	_ = s.Store.SetServerSourceTestResult(ctx, agentID, id, true, "")
	return s.reloadServerPublic(ctx, agentID, id)
}

func (s *Service) reloadServerPublic(ctx context.Context, agentID, id int64) (store.ServerSource, error) {
	src, err := s.Store.GetServerSource(ctx, agentID, id)
	if err != nil {
		return src, err
	}
	src.PasswordEnc = ""
	return src, nil
}

func (s *Service) requireServerSkill(ctx context.Context, agentID int64) error {
	if _, err := s.Store.GetManagedAgent(ctx, agentID); err != nil {
		return err
	}
	ok, err := s.agentHasInstalledSkill(ctx, agentID, skillServerControlID)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("install server control skill first")
	}
	return nil
}

// LoadServerControlPolicy builds gateway policy for an agent.
func (s *Service) LoadServerControlPolicy(ctx context.Context, agentID int64) *permission.ServerControlPolicy {
	if agentID <= 0 {
		return nil
	}
	ok, err := s.agentHasInstalledSkill(ctx, agentID, skillServerControlID)
	if err != nil || !ok {
		return nil
	}
	_, allowDel, allowRestart, err := s.Store.AgentServerControlFlags(ctx, agentID)
	if err != nil {
		return &permission.ServerControlPolicy{Installed: true}
	}
	return &permission.ServerControlPolicy{
		Installed:          true,
		AllowDelete:        allowDel,
		AllowDockerRestart: allowRestart,
	}
}

func (s *Service) compactServerSkillPrompt(ctx context.Context, agentID int64) string {
	sources, err := s.Store.ListServerSources(ctx, agentID)
	if err != nil {
		return "## Servers\n(no sources)"
	}
	block := store.FormatServerSourcesPromptCompact(sources)
	if block == "" {
		return "## Servers\n(no sources configured)"
	}
	return block
}
