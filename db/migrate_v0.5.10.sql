-- v0.5.10 数字员工像素小水母颜色 jelly_color
-- 服务启动时 EnsureJellyColorSchema 也会幂等补齐并回填。
USE colleague_avatar;

ALTER TABLE managed_agents
  ADD COLUMN jelly_color VARCHAR(16) NOT NULL DEFAULT '' AFTER avatar_url;

-- 已有员工按 id 稳定轮转回填（与 store.AssignJellyColor 一致：id%6）。
UPDATE managed_agents
SET jelly_color = ELT(MOD(id, 6) + 1, 'orange', 'yellow', 'blue', 'green', 'purple', 'red')
WHERE jelly_color = ''
   OR jelly_color NOT IN ('orange', 'yellow', 'blue', 'green', 'purple', 'red');
