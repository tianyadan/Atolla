package permission

import (
	"strings"
)

// ServerDangerClass categorizes destructive remote/server ops.
type ServerDangerClass string

const (
	ServerDangerNone           ServerDangerClass = ""
	ServerDangerAlwaysDeny     ServerDangerClass = "always_deny"     // reboot/shutdown/halt — 永不开放
	ServerDangerDelete         ServerDangerClass = "delete"          // rm / docker rm / stop / kill
	ServerDangerDockerRestart  ServerDangerClass = "docker_restart"  // docker/podman restart
)

// ServerControlPolicy comes from installed skill + per-server checkboxes (OR across servers).
type ServerControlPolicy struct {
	Installed          bool
	AllowDelete        bool // 勾选后仍强制人工确认
	AllowDockerRestart bool // 勾选后仍强制人工确认
}

// ClassifyServerDanger detects destructive patterns in the full command (含 ssh 远程命令串).
func ClassifyServerDanger(command string) ServerDangerClass {
	c := strings.ToLower(strings.TrimSpace(command))
	if c == "" {
		return ServerDangerNone
	}
	// 关机 / 重启整机：永远拒绝
	always := []string{
		"reboot", "shutdown", "halt", "poweroff", "init 0", "init 6",
		"systemctl poweroff", "systemctl reboot", "systemctl halt",
		"shutdown -h", "shutdown -r",
	}
	for _, p := range always {
		if strings.Contains(c, p) {
			return ServerDangerAlwaysDeny
		}
	}
	// Docker / Podman 重启容器
	if cmdHasAny(c, "docker restart", "podman restart", "docker compose restart", "docker-compose restart") {
		return ServerDangerDockerRestart
	}
	if strings.Contains(c, "systemctl restart") || (strings.Contains(c, "service ") && strings.Contains(c, "restart")) {
		// 系统服务重启视作不可勾选的破坏性操作
		return ServerDangerAlwaysDeny
	}
	// 删除 / 停止 / 杀掉
	if cmdHasAny(c,
		"docker rm", "docker rmi", "docker kill", "docker stop",
		"podman rm", "podman rmi", "podman kill", "podman stop",
		"docker system prune", "docker container prune", "docker volume rm",
		"kubectl delete", "kubectl drain",
		"rm -rf", "rm -fr", "rmdir ",
		"unlink ", "shred ",
	) {
		return ServerDangerDelete
	}
	// 裸 rm（非相对安全路径仍交由 AllowDelete 策略）
	argv := ParseArgv(command)
	bin := binName(argv)
	if bin == "rm" || bin == "unlink" || bin == "rmdir" {
		return ServerDangerDelete
	}
	if bin == "docker" || bin == "podman" {
		for _, t := range argv {
			switch strings.ToLower(t) {
			case "rm", "rmi", "kill", "stop", "prune":
				return ServerDangerDelete
			case "restart":
				return ServerDangerDockerRestart
			}
		}
	}
	return ServerDangerNone
}

func cmdHasAny(s string, parts ...string) bool {
	for _, p := range parts {
		if strings.Contains(s, p) {
			return true
		}
	}
	return false
}

// ApplyServerControlRules enforces skill-level hard rules (not prompt-only).
// Returns a decision when the rule applies; ok=false means no server-control rule matched.
func ApplyServerControlRules(a ToolAction, p ServerControlPolicy) (PermissionDecision, bool) {
	if !p.Installed {
		return PermissionDecision{}, false
	}
	cmd := a.Command
	if cmd == "" {
		cmd = strings.Join(a.argv, " ")
	}
	class := ClassifyServerDanger(cmd)
	// Also classify ActionType from shell adapter
	if class == ServerDangerNone {
		switch a.ActionType {
		case ActionServiceRestart:
			class = ServerDangerDockerRestart
			// system-level restart already AlwaysDeny via command patterns; docker restart stays
			if looksSystemRestart(cmd) {
				class = ServerDangerAlwaysDeny
			}
		case ActionProcessStop, ActionFileDelete:
			class = ServerDangerDelete
		case ActionSystemConfig:
			class = ServerDangerAlwaysDeny
		}
	}
	switch class {
	case ServerDangerAlwaysDeny:
		return PermissionDecision{
			Decision: DecisionDeny, Reason: "服务器技能硬规则：禁止关机/整机重启等破坏性操作",
			DecidedBy: DecidedByStatic, RuleID: "server_skill_always_deny",
		}, true
	case ServerDangerDelete:
		if !p.AllowDelete {
			return PermissionDecision{
				Decision: DecisionDeny, Reason: "服务器技能硬规则：未授权删除/停止类操作",
				DecidedBy: DecidedByStatic, RuleID: "server_skill_deny_delete",
			}, true
		}
		// 勾选后仍必须询问用户（不可会话记忆自动放行）
		return PermissionDecision{
			Decision: DecisionReview, Reason: "服务器技能：删除/停止类操作需每次人工确认",
			DecidedBy: DecidedByStatic, RuleID: "server_skill_ask_delete",
		}, true
	case ServerDangerDockerRestart:
		if !p.AllowDockerRestart {
			return PermissionDecision{
				Decision: DecisionDeny, Reason: "服务器技能硬规则：未授权重启容器",
				DecidedBy: DecidedByStatic, RuleID: "server_skill_deny_docker_restart",
			}, true
		}
		return PermissionDecision{
			Decision: DecisionReview, Reason: "服务器技能：重启容器需每次人工确认",
			DecidedBy: DecidedByStatic, RuleID: "server_skill_ask_docker_restart",
		}, true
	default:
		return PermissionDecision{}, false
	}
}

func looksSystemRestart(cmd string) bool {
	c := strings.ToLower(cmd)
	return strings.Contains(c, "systemctl restart") || strings.Contains(c, "service ") && strings.Contains(c, "restart")
}
