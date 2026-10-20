# 数字员工像素小水母颜色（jelly_color）

后端为每位数字员工增加 `jelly_color` 字段，供前端用「像素小水母」统一造型、按颜色区分员工。头像上传（`avatar_url`）保留，行为不变。

## 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `jelly_color` | string | 小水母颜色，必有合法取值 |

**合法取值（仅此六种）：** `orange` / `yellow` / `blue` / `green` / `purple` / `red`

非法值接口返回 **400**，错误信息：`jelly_color must be orange|yellow|blue|green|purple|red`。

## 自动分配

创建时若不传 `jelly_color`，后端按员工 `id` 稳定轮转：

```
color = ["orange","yellow","blue","green","purple","red"][id % 6]
```

已有员工在迁移 / 启动幂等补齐时用同一规则回填。

## 接口示例

### 一键招聘 `POST /api/admin/agents`

```json
{
  "name": "小蓝",
  "engine": "claude",
  "jelly_color": "blue"
}
```

省略 `jelly_color` 时自动分配。响应体为完整员工对象，含 `jelly_color`。

### 人才市场招聘 `POST /api/admin/talent-market/hire`

```json
{
  "talent_id": "frontend_engineer",
  "name": "前端同学",
  "engine": "claude",
  "jelly_color": "green"
}
```

### 复制员工 `POST /api/admin/agents/:id/copy`

```json
{
  "name": "小蓝 副本",
  "jelly_color": "yellow"
}
```

不传则按**新员工 id** 自动分配（不继承源员工颜色，便于同组分散）。`avatar_url` 仍可覆盖，默认复制源头像。

### 更新 `PATCH /api/admin/agents/:id`

```json
{
  "jelly_color": "purple"
}
```

仅当请求体包含 `jelly_color` 时修改；省略则保持原色。

### 列表 / 详情

`GET /api/admin/agents` 列表项、创建/更新/设前台/归组等返回的员工对象，以及公开前台 `GET /api/public/receptionist`、手机端 agents 镜像 payload，均带 `jelly_color`。

## 数据库

- 全量建表：`db/schema.sql` 中 `managed_agents.jelly_color`
- 增量：`db/migrate_v0.5.10.sql`
- 启动时 `Store.EnsureJellyColorSchema` 幂等加列并回填空/非法色
