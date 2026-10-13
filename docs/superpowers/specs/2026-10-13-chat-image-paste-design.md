# 聊天贴图发送（多模态）设计

日期：2026-10-13  
范围：管理台数字人对话 + 前台访客聊天

## 要点

- 粘贴/拖拽图片 → 预览可删 → 与问题一并发送
- 上传落盘（+可选 OSS），消息 `meta_json.attachments` 存 URL
- Claude：stream-json image base64；Codex/Cursor：工作区文件路径
- 对话缩略图 + Lightbox 放大
