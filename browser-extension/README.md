# Atolla Browser Control

轻量级 Chrome Manifest V3 扩展。扩展运行在用户主动加载的 Chrome 配置中，因而可以复用该配置已有的网页登录态；Atolla Go 后端通过固定 REST 动作派发任务，扩展通过 WebSocket 执行并回传统一 JSON 结果。`chatgpt.send_message` 可直接向已登录的 ChatGPT 网页发送问题并返回原始回复文本，不调用额外模型。

## 安全边界

- REST API 使用独立 `AVATAR_BROWSER_TOKEN`，WebSocket 首个 `hello` 消息使用同一 Token。
- 默认只接受 `127.0.0.1` / `::1` 请求；`AVATAR_BROWSER_ALLOW_REMOTE=1` 才允许非本机 API 客户端。
- 默认只允许访问本机测试页、`chatgpt.com` 与兼容旧地址 `chat.openai.com`；通过 `AVATAR_BROWSER_ALLOWED_DOMAINS` 添加精确域名或 `*.example.com`。
- 扩展只实现固定动作，不接收、拼接或执行任意 JavaScript。
- Chrome 会在加载扩展时展示 `tabs`、页面读取和截图等权限，必须由用户确认，不会绕过权限提示。

## 启动与安装

一键构建并启动 Atolla：

```bash
./scripts/start-browser-control.sh
# 后台运行：./scripts/start-browser-control.sh --daemon
```

脚本会生成临时 Token、构建扩展并打印加载目录。然后打开 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”，加载：

```text
dist/browser-extension
```

点击扩展图标进入设置，把脚本打印的 Token 保存即可。正式环境建议将 Token 持久化在仓库根目录的 `.env`（该文件已忽略）：

```dotenv
AVATAR_BROWSER_TOKEN=使用 openssl rand -hex 32 生成
AVATAR_BROWSER_ALLOWED_DOMAINS=localhost,127.0.0.1,chatgpt.com,chat.openai.com
AVATAR_BROWSER_ALLOW_REMOTE=0
```

## REST API

所有结果结构一致：

```json
{
  "ok": true,
  "task_id": "task-...",
  "data": {},
  "duration_ms": 12
}
```

失败时返回 `ok=false`、`error` 和稳定的 `code`。支持动作：

| 动作 | 主要参数 | 说明 |
| --- | --- | --- |
| `tabs.list` | 无 | 仅返回白名单域名标签页 |
| `tabs.open` | `url`, `active` | 打开白名单网页 |
| `dom.read` | `tab_id`, `selector`, `max_length` | 读取匹配元素文本、HTML、属性和值 |
| `dom.input` | `tab_id`, `selector`, `text` | 输入文本并触发 input/change |
| `dom.click` | `tab_id`, `selector` | 滚动到元素并点击 |
| `page.content` | `tab_id`, `include_html`, `max_length` | 获取标题、URL、正文及可选 HTML |
| `page.screenshot` | `tab_id`, `format`, `quality`, `activate` | 截取活动标签页；非活动页需显式 `activate=true` |
| `chatgpt.send_message` | `text`, `tab_id`, `open_new` | 复用 ChatGPT 登录态发送问题，等待流式回复结束并返回文本 |

### 发送 ChatGPT 消息

先在安装扩展的 Chrome 中登录 `https://chatgpt.com`。调用时可以省略 `tab_id`：扩展会优先复用已经打开的 ChatGPT 标签页，没有则自动打开新标签页。为避免回复串台，同一时间只允许一个 ChatGPT 任务运行。

```bash
TOKEN='替换为 AVATAR_BROWSER_TOKEN'
curl -s http://127.0.0.1:8080/api/browser/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"chatgpt.send_message","timeout_ms":180000,"params":{"text":"请用三句话介绍 Go 语言"}}'
```

成功结果的 `data.response` 是 ChatGPT 页面中最新一条 Assistant 回复的原始文本，同时返回 `conversation_url`、页面标题和标签页信息。登录失效返回 `CHATGPT_LOGIN_REQUIRED`，页面结构不兼容返回 `CHATGPT_COMPOSER_NOT_FOUND`；回复超时和并发占用也会返回稳定的 `CHATGPT_*` 错误码。

### ChatGPT 页面适配层

ChatGPT 的输入框、发送按钮、Assistant 回复和生成状态识别集中在 `adapters/chatgpt.mjs`。适配器同时保留多代选择器，并通过可见性、按钮语义和回复单元标识进行运行时探测；页面改版时只需维护该文件，无需修改 WebSocket 或任务调度代码。

DOM 无法识别时会在数秒内返回错误，并在 `data.diagnostics` 中附带 URL、标题、各选择器命中数及候选元素属性。诊断数据不会包含输入内容、回复正文或整页 HTML。

连接状态：

```bash
TOKEN='替换为 AVATAR_BROWSER_TOKEN'
curl -s http://127.0.0.1:8080/api/browser/status \
  -H "Authorization: Bearer $TOKEN"
```

列出标签页：

```bash
curl -s http://127.0.0.1:8080/api/browser/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"tabs.list","timeout_ms":10000,"params":{}}'
```

打开网页：

```bash
curl -s http://127.0.0.1:8080/api/browser/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"task_id":"demo-open-01","action":"tabs.open","params":{"url":"http://127.0.0.1:5173","active":true}}'
```

DOM 输入与点击：

```bash
curl -s http://127.0.0.1:8080/api/browser/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"dom.input","params":{"tab_id":123,"selector":"#search","text":"Atolla"}}'

curl -s http://127.0.0.1:8080/api/browser/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"action":"dom.click","params":{"tab_id":123,"selector":"button[type=submit]"}}'
```

## 构建与测试

```bash
./scripts/build-browser-extension.sh
./scripts/test-browser-control.sh
```

有 Chrome for Testing 时执行 HTTP → WebSocket → DOM 输入/点击/读取测试：

```bash
CHROME_FOR_TESTING_BIN='/path/to/chrome' ./scripts/test-browser-control.sh --chrome
```

截图目前是可选能力，需要验证时显式追加参数：

```bash
CHROME_FOR_TESTING_BIN='/path/to/chrome' ./scripts/test-browser-control.sh --chrome --screenshot
```

端到端测试使用独立临时 Chrome Profile，不读取或修改日常 Chrome 配置。普通用户手动加载扩展到自己的 Chrome 后，才会复用该 Chrome 的登录态。

`chatgpt.send_message` 不纳入自动化测试：独立测试 Profile 没有用户的 ChatGPT 登录态。安装后请使用上面的 curl 示例完成一次人工验收。
