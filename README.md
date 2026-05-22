<p align="center">
  <img src="https://img.shields.io/badge/DeepSeek-V4%20Pro-4B8BF5?style=for-the-badge&logo=deepseek&logoColor=white" alt="DeepSeek V4 Pro">
  <img src="https://img.shields.io/badge/GitHub-Copilot-2F363D?style=for-the-badge&logo=githubcopilot&logoColor=white" alt="GitHub Copilot">
  <img src="https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun">
</p>

<h1 align="center">🚀 DeepSeek Proxy for GitHub Copilot</h1>

<p align="center">
  <strong>让 GitHub Copilot Chat 用上 DeepSeek V4 Pro 的本地代理</strong><br>
  <em>A lightweight local proxy that brings DeepSeek V4 Pro to GitHub Copilot Chat</em>
</p>

<p align="center">
  <a href="#-一键安装"><strong>中文文档</strong></a> ·
  <a href="#-quick-start"><strong>English</strong></a> ·
  <a href="#-how-it-works">工作原理</a> ·
  <a href="#-features">Features</a>
</p>

---

## 📌 一句话介绍 / One-Liner

**CN:** 一行命令，让 VS Code / Cursor 的 GitHub Copilot Chat 免费直连 DeepSeek V4 Pro（671B 参数 · 100 万上下文 · 深度推理），无需修改 Copilot 插件本身。

**EN:** One command to supercharge GitHub Copilot Chat with DeepSeek V4 Pro (671B params, 1M context, reasoning mode) — no Copilot plugin hacking needed.

---

## ✨ Features / 核心特性

| 特性 | 说明 |
|------|------|
| 🔌 **零侵入** | 伪装成本地 Ollama 服务，Copilot 原生兼容，无需魔改插件 |
| 🧠 **三种思考模式** | `auto` 智能分类 / `enabled` 始终推理 / `disabled` 极速响应 |
| 🤖 **智能路由** | `auto` 模式下自动判断问题复杂度，简单问题秒回，复杂问题深度思考 |
| 📏 **百万上下文** | 支持 DeepSeek V4 Pro 原生 1M token 上下文窗口 |
| 🔧 **工具调用** | 完整支持 Copilot 的 function calling / tool use |
| 🔄 **自动重试** | 连接异常自动重试，保障稳定性 |
| 🚀 **开机自启** | launchd 守护进程，重启 Mac 后自动运行 |
| 📦 **一键安装** | 全自动脚本：装依赖 → 配 Key → 写模型 → 启动 → 验证 |

---

## 🎬 Quick Start / 一键安装

```bash
git clone https://github.com/Camel-Prince/deepseek-copilot-proxy.git
cd deepseek-copilot-proxy
./install.sh
```

脚本会引导你完成全部配置。完成后重启 VS Code / Cursor，用 `Cmd+Shift+P` → `Chat: Switch Model` → 选择 `deepseek-v4-pro`。

### 前提条件

- macOS (Intel / Apple Silicon)
- [DeepSeek API Key](https://platform.deepseek.com/api_keys)
- GitHub Copilot (免费版 / Pro 均可)

---

## 🔧 手动安装 / Manual Setup

<details>
<summary>展开查看手动安装步骤</summary>

### 1. 安装 Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. 设置环境变量

```bash
export OPENAI_API_KEY="sk-your-deepseek-api-key"
export DEEPSEEK_THINKING=auto    # auto | enabled | disabled
```

### 3. 启动代理

```bash
mkdir -p ~/deepseek-proxy/logs
cp proxy.ts ~/deepseek-proxy/
cd ~/deepseek-proxy
OPENAI_API_KEY="sk-your-key" DEEPSEEK_THINKING=auto bun run proxy.ts
```

### 4. 配置 Copilot 模型列表

编辑 `~/Library/Application Support/Code/User/chatLanguageModels.json`（不存在则新建）：

```json
[
    { "name": "Copilot", "vendor": "copilot" },
    { "name": "deepseek-v4-pro", "vendor": "ollama", "url": "http://[::1]:8765" }
]
```

其他编辑器路径：

| 编辑器 | 模型配置文件路径 |
|--------|-----------------|
| VS Code | `~/Library/Application Support/Code/User/chatLanguageModels.json` |
| VS Code Insiders | `~/Library/Application Support/Code - Insiders/User/chatLanguageModels.json` |
| Cursor | `~/Library/Application Support/Cursor/User/chatLanguageModels.json` |

</details>

---

## 🧠 思考模式详解 / Thinking Modes

| 模式 | 环境变量 | 行为 | 适用场景 |
|------|---------|------|---------|
| 🔵 **Auto**（推荐） | `DEEPSEEK_THINKING=auto` | 自动分类问题复杂度，简单问题跳过推理 | 日常开发，兼顾速度与质量 |
| 🟢 **Enabled** | `DEEPSEEK_THINKING=enabled` | 始终开启深度推理 | 复杂架构、算法设计 |
| ⚪ **Disabled** | `DEEPSEEK_THINKING=disabled` | 始终关闭推理，最快响应 | 简单问答、代码补全 |

> 💡 `auto` 模式通过一次轻量级分类调用判断问题是否需要深度推理。已进入 tool-calling 链路的对话会自动保持推理开启。

---

## 🏗️ 工作原理 / How It Works

```
┌──────────────┐     Ollama HTTP      ┌──────────────────┐     OpenAI HTTP      ┌──────────────────┐
│  VS Code /   │ ──────────────────→  │  Bun Proxy       │ ──────────────────→  │  api.deepseek    │
│  Cursor      │ ←──────────────────  │  localhost:8765   │ ←──────────────────  │  .com            │
│  Copilot     │     Ollama Response   │                  │     OpenAI Response   │                  │
└──────────────┘                      └──────────────────┘                      └──────────────────┘
```

1. VS Code Copilot 的 "Ollama" provider 向 `http://[::1]:8765` 发送 Ollama 格式请求
2. Bun 代理接收请求，Mock Ollama `/api/version`、`/api/tags`、`/api/show` 等端点
3. 将 `/api/chat` 请求翻译为 OpenAI `/v1/chat/completions` 格式
4. 注入 DeepSeek API Key，根据思考模式配置添加 `thinking` 参数
5. 转发到 `api.deepseek.com`，将响应翻译回 Ollama 格式返回给 Copilot

**核心处理逻辑（proxy.ts）：**

- **消息清理**：自动合并连续同角色消息、修剪孤立的 tool_calls / tool 消息、重排 tool 消息顺序 — 确保符合 DeepSeek API 严格的消息格式要求
- **重试机制**：对 `ConnectionRefused`、`ECONNRESET` 等瞬时网络错误自动重试 3 次（指数退避）
- **流式透传**：SSE 流直接透传，idleTimeout 设为 255s 以兼容推理模式的长思考时间
- **思考归一化**：在 `enabled` 模式下自动为历史 assistant 消息注入空的 `reasoning_content` 字段，确保多轮对话通过 DeepSeek 的校验

---

## 📁 项目结构 / Project Structure

```
deepseek-copilot-proxy/
├── proxy.ts                          # 核心代理（Bun 单文件）
├── install.sh                        # 一键安装脚本
├── chatLanguageModels.json           # 模型配置参考
├── com.local.deepseek-proxy.plist.template  # launchd 模板
└── README.md
```

---

## 🛠️ 运维管理 / Management

```bash
# 查看日志
tail -f ~/deepseek-proxy/logs/out.log

# 停止代理
launchctl unload ~/Library/LaunchAgents/com.local.deepseek-proxy.plist

# 启动代理
launchctl load ~/Library/LaunchAgents/com.local.deepseek-proxy.plist

# 验证代理是否运行
curl -s http://localhost:8765/api/version
```

---

## ❓ 常见问题 / FAQ

<details>
<summary><strong>Q: 免费版 Copilot 能用吗？</strong></summary>
✅ 完全支持。本代理只利用了 Copilot 的 Ollama provider 能力（连接本地模型），不依赖 Copilot Pro 订阅。
</details>

<details>
<summary><strong>Q: 代理是否安全？我的 API Key 会泄露吗？</strong></summary>
API Key 仅存储在本地（环境变量 & launchd plist），代理不向除 `api.deepseek.com` 以外的任何地址发送请求。
</details>

<details>
<summary><strong>Q: 能同时保留 Copilot 原生模型吗？</strong></summary>
✅ 可以。安装脚本会在模型列表中同时保留 Copilot 和 deepseek-v4-pro，用 `Cmd+Shift+P` 随时切换。
</details>

<details>
<summary><strong>Q: 支持 Windows / Linux 吗？</strong></summary>
当前安装脚本针对 macOS。Linux 可参考手动安装步骤（将 launchd 替换为 systemd），Windows 可手动运行 `bun run proxy.ts`。
</details>

<details>
<summary><strong>Q: API 费用如何？</strong></summary>
参考 [DeepSeek 官方定价](https://platform.deepseek.com/pricing)。<br>
- 输入：¥1 / 百万 tokens<br>
- 输出（非思考）：¥2 / 百万 tokens<br>
- 输出（思考模式）：¥4 / 百万 tokens<br>
日常使用成本极低，推荐开启 `auto` 模式节省推理 token。
</details>

---

## 📄 License

MIT License

---

<p align="center">
  <sub>Made with ❤️ for developers who want the best of both worlds: Copilot's seamless IDE integration + DeepSeek's powerful reasoning.</sub>
</p>


```bash
# 替换 __DEEPSEEK_API_KEY__ 为你的真实 Key
# 替换 __BUN_PATH__ 为 `which bun` 的输出
# 替换 __PROXY_DIR__ 为 ~/deepseek-proxy

cp com.local.deepseek-proxy.plist.template ~/Library/LaunchAgents/com.local.deepseek-proxy.plist
# 手动编辑 ~/Library/LaunchAgents/com.local.deepseek-proxy.plist 中的占位符
launchctl load ~/Library/LaunchAgents/com.local.deepseek-proxy.plist
```

## 使用

1. 重启 VS Code
2. `Cmd+Shift+P` → 搜索 `Chat: Switch Model`
3. 选择 `deepseek-v4-pro`
4. 正常使用 Copilot Chat

## 验证

```bash
# 版本握手
curl http://localhost:8765/api/version

# 模型列表
curl http://localhost:8765/api/tags

# Chat 测试
curl http://[::1]:8765/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{"model":"deepseek-v4-pro","messages":[{"role":"user","content":"hi"}],"max_tokens":100}'
```

## 运维

```bash
# 查看日志
tail -f ~/deepseek-proxy/logs/out.log

# 重启代理
launchctl unload ~/Library/LaunchAgents/com.local.deepseek-proxy.plist
launchctl load ~/Library/LaunchAgents/com.local.deepseek-proxy.plist

# 停止代理
launchctl unload ~/Library/LaunchAgents/com.local.deepseek-proxy.plist
```

## 文件说明

| 文件                                        | 用途                         |
| ------------------------------------------- | ---------------------------- |
| `proxy.ts`                                | Bun 代理主程序               |
| `install.sh`                              | 一键安装脚本                 |
| `com.local.deepseek-proxy.plist.template` | launchd 自启配置模板         |
| `chatLanguageModels.json`                 | Copilot 模型配置文件（参考） |

## 常见问题

### 模型列表不显示 deepseek-v4-pro

确认 `chatLanguageModels.json` 中包含 `deepseek-v4-pro` 条目且 `vendor` 为 `"ollama"`，URL 为 `http://[::1]:8765`。重启 VS Code。

### 代理启动但 Copilot 连接失败

检查 `http://[::1]:8765/api/version` 是否返回 `{"version":"0.9.0"}`。如果 `localhost` 不通但 `[::1]` 通，说明 IPv4/IPv6 分裂 — 在 Copilot 配置中使用 `http://[::1]:8765`。

### 多轮对话报 400 错误

这是 DeepSeek 思考模式的已知问题。代理已自动处理 `reasoning_content` 占位、tool call 排序、孤儿消息清理。如果仍然出现，请提 issue 附上日志。

### 上游返回 "bad request, http smuggling"

代理已自动合并连续同角色消息并清理 hop-by-hop 头。如果仍有此错误，检查是否通过其他代理（ClashX/V2Ray）联网 — 确保 `NO_PROXY=localhost,127.0.0.1,::1`。
