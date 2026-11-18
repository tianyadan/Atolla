package store

import (
	"context"
	"fmt"
)

// EnsureJellyColorSchema 幂等添加 jelly_color，并为已有/空值员工按 id 回填稳定默认色。
func (s *Store) EnsureJellyColorSchema(ctx context.Context) error {
	if err := s.addColumnIfMissing(ctx, "managed_agents", "jelly_color",
		`ALTER TABLE managed_agents ADD COLUMN jelly_color VARCHAR(16) NOT NULL DEFAULT ''`); err != nil {
		return err
	}
	return s.backfillJellyColors(ctx)
}

// backfillJellyColors 把空或非法颜色按员工 id 稳定轮转回填。
func (s *Store) backfillJellyColors(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, IFNULL(jelly_color,'') FROM managed_agents`)
	if err != nil {
		return err
	}
	defer rows.Close()
	type pair struct {
		id    int64
		color string
	}
	var need []pair
	for rows.Next() {
		var p pair
		if err := rows.Scan(&p.id, &p.color); err != nil {
			return err
		}
		if !ValidJellyColor(p.color) {
			need = append(need, p)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, p := range need {
		c := AssignJellyColor(p.id)
		if _, err := s.db.ExecContext(ctx, `UPDATE managed_agents SET jelly_color=? WHERE id=?`, c, p.id); err != nil {
			return fmt.Errorf("backfill jelly_color id=%d: %w", p.id, err)
		}
	}
	return nil
}
