package permission

import "testing"

func TestClassifyServerDanger(t *testing.T) {
	cases := []struct {
		cmd  string
		want ServerDangerClass
	}{
		{"reboot", ServerDangerAlwaysDeny},
		{"sudo shutdown -h now", ServerDangerAlwaysDeny},
		{"ssh root@h 'reboot'", ServerDangerAlwaysDeny},
		{"docker restart web", ServerDangerDockerRestart},
		{"ssh h docker restart api", ServerDangerDockerRestart},
		{"docker rm -f web", ServerDangerDelete},
		{"rm -rf /var/log/x", ServerDangerDelete},
		{"docker ps", ServerDangerNone},
		{"systemctl status nginx", ServerDangerNone},
		{"systemctl restart nginx", ServerDangerAlwaysDeny},
	}
	for _, tc := range cases {
		if got := ClassifyServerDanger(tc.cmd); got != tc.want {
			t.Fatalf("cmd=%q got=%s want=%s", tc.cmd, got, tc.want)
		}
	}
}

func TestApplyServerControlRules(t *testing.T) {
	a := FromShell("claude", 1, 1, "docker restart web", "/ws", "")
	// 未安装技能：不命中
	if _, hit := ApplyServerControlRules(a, ServerControlPolicy{}); hit {
		t.Fatal("expected miss when not installed")
	}
	// 已安装未勾选：拒绝
	d, hit := ApplyServerControlRules(a, ServerControlPolicy{Installed: true})
	if !hit || d.Decision != DecisionDeny {
		t.Fatalf("want deny got %+v hit=%v", d, hit)
	}
	// 勾选后：强制询问
	d, hit = ApplyServerControlRules(a, ServerControlPolicy{Installed: true, AllowDockerRestart: true})
	if !hit || d.Decision != DecisionReview {
		t.Fatalf("want review got %+v", d)
	}
	// 关机永远拒绝
	reboot := FromShell("claude", 1, 1, "reboot", "/ws", "")
	d, hit = ApplyServerControlRules(reboot, ServerControlPolicy{Installed: true, AllowDelete: true, AllowDockerRestart: true})
	if !hit || d.Decision != DecisionDeny {
		t.Fatalf("reboot must deny got %+v", d)
	}
}

func TestGatewayServerSkillForcesReview(t *testing.T) {
	g := NewGateway(nil, nil)
	a := FromShell("claude", 1, 1, "docker restart redis", "/ws", "")
	d := g.Evaluate(nil, a, EvaluateOpts{
		ServerControl: &ServerControlPolicy{Installed: true, AllowDockerRestart: true},
	})
	if d.Decision != DecisionReview {
		t.Fatalf("want REVIEW got %s (%s)", d.Decision, d.Reason)
	}
	d2 := g.Evaluate(nil, a, EvaluateOpts{
		ServerControl: &ServerControlPolicy{Installed: true},
	})
	if d2.Decision != DecisionDeny {
		t.Fatalf("want DENY got %s", d2.Decision)
	}
}
