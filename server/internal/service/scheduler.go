package service

import (
	"context"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/robfig/cron/v3"
)

// Scheduler 管理型智能体定时任务。
type Scheduler struct {
	svc     *Service
	mu      sync.Mutex
	cron    *cron.Cron
	entries map[int64]cron.EntryID
}

// NewScheduler 创建并启动空调度器（含每日维护任务）。
func NewScheduler(svc *Service) *Scheduler {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.Local
	}
	c := cron.New(cron.WithLocation(loc))
	c.Start()
	sch := &Scheduler{svc: svc, cron: c, entries: map[int64]cron.EntryID{}}
	sch.startMaintenanceJobs()
	return sch
}

// startMaintenanceJobs 注册全局维护定时任务。
func (sch *Scheduler) startMaintenanceJobs() {
	if sch == nil || sch.cron == nil {
		return
	}
	// 每天 12:00（上海时区）清理超过 7 天的自动审批审计
	_, err := sch.cron.AddFunc("0 12 * * *", func() {
		sch.purgeAutoApproveAudits()
		sch.purgeLocalChatImages()
	})
	if err != nil {
		log.Printf("scheduler maintenance auto-approve purge: %v", err)
	} else {
		log.Printf("scheduler armed auto-approve audit purge cron=0 12 * * * (Asia/Shanghai)")
	}
	// Best-effort OSS lifecycle for chat images (7 days)
	go sch.svc.EnsureChatImageOSSLifecycle()
}

// purgeLocalChatImages deletes local chat images older than 7 days.
func (sch *Scheduler) purgeLocalChatImages() {
	if sch == nil || sch.svc == nil {
		return
	}
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	n, err := sch.svc.PurgeLocalChatImagesOlderThan(cutoff)
	if err != nil {
		log.Printf("chat-image local purge: %v", err)
		return
	}
	if n > 0 {
		log.Printf("chat-image local purged %d files older than %s", n, cutoff.Format(time.RFC3339))
	}
}

// purgeAutoApproveAudits 删除 7 天前的自动审批记录。
func (sch *Scheduler) purgeAutoApproveAudits() {
	if sch == nil || sch.svc == nil || sch.svc.Store == nil {
		return
	}
	ctx := context.Background()
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	n, err := sch.svc.Store.PurgeAutoApproveAuditsOlderThan(ctx, cutoff)
	if err != nil {
		log.Printf("auto-approve audit purge: %v", err)
		return
	}
	if n > 0 {
		log.Printf("auto-approve audit purged %d rows older than %s", n, cutoff.Format(time.RFC3339))
	}
}

// Reload 按数据库重建全部定时任务。
func (sch *Scheduler) Reload(ctx context.Context) {
	if sch == nil {
		return
	}
	items, err := sch.svc.Store.ListScheduledAgents(ctx)
	if err != nil {
		log.Printf("scheduler list: %v", err)
		return
	}
	sch.mu.Lock()
	defer sch.mu.Unlock()
	for id, eid := range sch.entries {
		sch.cron.Remove(eid)
		delete(sch.entries, id)
	}
	for _, a := range items {
		agent := a
		spec := strings.TrimSpace(agent.ScheduleCron)
		if spec == "" {
			continue
		}
		id := agent.ID
		eid, err := sch.cron.AddFunc(spec, func() {
			sch.runAgent(id)
		})
		if err != nil {
			log.Printf("scheduler add agent=%d cron=%q: %v", id, spec, err)
			continue
		}
		sch.entries[id] = eid
		log.Printf("scheduler armed agent=%d cron=%q label=%q", id, spec, agent.ScheduleLabel)
	}
}

func (sch *Scheduler) runAgent(agentID int64) {
	ctx := context.Background()
	a, err := sch.svc.Store.GetManagedAgent(ctx, agentID)
	if err != nil || a == nil || !a.ScheduleEnabled {
		return
	}
	if a.Status == "running" {
		log.Printf("scheduler skip agent=%d already running", agentID)
		return
	}
	if occ, _ := sch.svc.Store.GetOccupancy(ctx, agentID); occ != nil {
		log.Printf("scheduler skip agent=%d occupied by %s", agentID, occ.SourceType)
		return
	}
	q := "【定时任务】请按你的规则与权限策略执行例行工作,并简要汇报结果。"
	if a.ScheduleLabel != "" {
		q = "【定时任务·" + a.ScheduleLabel + "】请按你的规则与权限策略执行例行工作,并简要汇报结果。"
	}
	_, err = sch.svc.AskManaged(ctx, agentID, q, nil)
	if err != nil {
		log.Printf("scheduler ask agent=%d: %v", agentID, err)
	}
}

// Stop 停止调度。
func (sch *Scheduler) Stop() {
	if sch == nil || sch.cron == nil {
		return
	}
	ctx := sch.cron.Stop()
	<-ctx.Done()
}
