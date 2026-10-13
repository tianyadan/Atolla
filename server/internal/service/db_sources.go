package service

import (
	"context"
	"fmt"
	"strings"

	"atolla/server/internal/store"
	"atolla/server/internal/testsrv"
)

const skillDatabaseID = "atolla.database"

// ListDBClients returns status for one type (type query) or empty map.
func (s *Service) ListDBClients(dbType string) map[string]DBClientStatus {
	dbType = strings.TrimSpace(dbType)
	if dbType == "" {
		return map[string]DBClientStatus{}
	}
	st := DetectDBClient(dbType)
	return map[string]DBClientStatus{st.DBType: st}
}

// ListAgentDBSources lists datasources; client_ok only for types that appear in the list.
func (s *Service) ListAgentDBSources(ctx context.Context, agentID int64) ([]store.DBSource, error) {
	if err := s.requireDatabaseSkill(ctx, agentID); err != nil {
		return nil, err
	}
	items, err := s.Store.ListDBSources(ctx, agentID)
	if err != nil {
		return nil, err
	}
	var types []string
	for _, it := range items {
		types = append(types, it.DBType)
	}
	clients := DetectDBClientsForTypes(types)
	for i := range items {
		ok, bin := attachClientStatus(items[i].DBType, clients)
		items[i].ClientOK = ok
		items[i].ClientBin = bin
		items[i].PasswordEnc = ""
	}
	return items, nil
}

// CreateAgentDBSource creates an encrypted datasource.
func (s *Service) CreateAgentDBSource(ctx context.Context, agentID int64, in store.DBSourceInput) (store.DBSource, error) {
	if err := s.requireDatabaseSkill(ctx, agentID); err != nil {
		return store.DBSource{}, err
	}
	enc := ""
	if strings.TrimSpace(in.Password) != "" {
		var err error
		enc, err = testsrv.EncryptPassword(s.Cfg.SecretKey, in.Password)
		if err != nil {
			return store.DBSource{}, fmt.Errorf("encrypt password: %w", err)
		}
	}
	src, err := s.Store.CreateDBSource(ctx, agentID, in, enc)
	if err != nil {
		return src, err
	}
	return s.decorateSource(src), nil
}

// UpdateAgentDBSource updates a datasource; empty password keeps existing.
func (s *Service) UpdateAgentDBSource(ctx context.Context, agentID, id int64, in store.DBSourceInput) (store.DBSource, error) {
	if err := s.requireDatabaseSkill(ctx, agentID); err != nil {
		return store.DBSource{}, err
	}
	var passEnc *string
	if in.ClearPassword {
		empty := ""
		passEnc = &empty
	} else if strings.TrimSpace(in.Password) != "" {
		enc, err := testsrv.EncryptPassword(s.Cfg.SecretKey, in.Password)
		if err != nil {
			return store.DBSource{}, fmt.Errorf("encrypt password: %w", err)
		}
		passEnc = &enc
	}
	src, err := s.Store.UpdateDBSource(ctx, agentID, id, in, passEnc)
	if err != nil {
		return src, err
	}
	return s.decorateSource(src), nil
}

// DeleteAgentDBSource removes a datasource.
func (s *Service) DeleteAgentDBSource(ctx context.Context, agentID, id int64) error {
	if err := s.requireDatabaseSkill(ctx, agentID); err != nil {
		return err
	}
	return s.Store.DeleteDBSource(ctx, agentID, id)
}

func (s *Service) decorateSource(src store.DBSource) store.DBSource {
	st := DetectDBClient(src.DBType)
	src.ClientOK = st.OK
	src.ClientBin = st.Bin
	src.PasswordEnc = ""
	return src
}

func (s *Service) requireDatabaseSkill(ctx context.Context, agentID int64) error {
	if _, err := s.Store.GetManagedAgent(ctx, agentID); err != nil {
		return err
	}
	ok, err := s.agentHasInstalledSkill(ctx, agentID, skillDatabaseID)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("install database skill first")
	}
	return nil
}

func (s *Service) agentHasInstalledSkill(ctx context.Context, agentID int64, skillID string) (bool, error) {
	skills, err := s.Store.ListInstalledAgentSkills(ctx, agentID)
	if err != nil {
		return false, err
	}
	for _, sk := range skills {
		if sk.ID == skillID {
			return true, nil
		}
	}
	return false, nil
}

// compactDatabaseSkillPrompt replaces verbose catalog text with short DS inventory.
func (s *Service) compactDatabaseSkillPrompt(ctx context.Context, agentID int64) string {
	sources, err := s.Store.ListDBSources(ctx, agentID)
	if err != nil {
		return "## DB\n(no sources)"
	}
	var types []string
	for _, src := range sources {
		types = append(types, src.DBType)
	}
	clients := DetectDBClientsForTypes(types)
	for i := range sources {
		ok, bin := attachClientStatus(sources[i].DBType, clients)
		sources[i].ClientOK = ok
		sources[i].ClientBin = bin
	}
	block := store.FormatDBSourcesPromptCompact(sources)
	if block == "" {
		return "## DB\n(no sources configured)"
	}
	return block
}
