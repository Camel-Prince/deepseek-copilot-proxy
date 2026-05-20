# DeepSeek Proxy for GitHub Copilot

通过本地 Bun 代理模拟 Ollama HTTP 协议，使 VS Code / Cursor 的 GitHub Copilot Chat 使用 DeepSeek V4 Pro（100 万上下文 + 思考模式）。

## 工作原理

```
VS Code Copilot ──Ollama HTTP──→ localhost:8765 (Bun proxy) ──OpenAI HTTP──→ api.deepseek.com
```

代理伪装成 Ollama 服务，Copilot 以为在跟本地 Ollama 对话，实际请求被转发到 DeepSeek API。

## 前置条件

- macOS（Intel 或 Apple Silicon）
- DeepSeek API Key（[platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys)）
- GitHub Copilot（免费版或 Pro）

## 一键安装

```bash
git clone https://github.com/Camel-Prince/deepseek-copilot-proxy.git
cd deepseek-copilot-proxy
./install.sh
```

安装脚本会自动：

1. 询问你的 DeepSeek API Key
2. 安装 Bun（如未安装）
3. 复制 `proxy.ts` 到 `~/deepseek-proxy/`
4. 生成并加载 launchd 自启配置（开机自动运行）
5. 自动配置 VS Code / VS Code Insiders / Cursor 的模型列表
6. 验证代理是否正常运行

## 手动安装

如果不想用安装脚本，按以下步骤操作：

### 1. 安装 Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. 配置 API Key

```bash
export OPENAI_API_KEY="sk-your-deepseek-api-key"
```

可选：设置思考模式

```bash
export DEEPSEEK_THINKING=auto    # auto | enabled | disabled
```

- `auto`：智能分类，简单问题跳过思考（推荐，省 token）
- `enabled`：始终开启思考
- `disabled`：始终关闭思考（最快）

### 3. 复制并启动代理

```bash
mkdir -p ~/deepseek-proxy/logs
cp proxy.ts ~/deepseek-proxy/
cd ~/deepseek-proxy
OPENAI_API_KEY="sk-your-key" DEEPSEEK_THINKING=auto bun run proxy.ts
```

### 4. 配置 Copilot 模型

编辑 VS Code 的 `chatLanguageModels.json`：

**路径：** `~/Library/Application Support/Code/User/chatLanguageModels.json`

```json
[
    {
        "name": "Copilot",
        "vendor": "copilot"
    },
    {
        "name": "deepseek-v4-pro",
        "vendor": "ollama",
        "url": "http://[::1]:8765"
    }
]
```

> 如果已有 Copilot 条目，只需在数组末尾追加 `deepseek-v4-pro` 条目即可。

其他编辑器路径：

- VS Code Insiders: `~/Library/Application Support/Code - Insiders/User/chatLanguageModels.json`
- Cursor: `~/Library/Application Support/Cursor/User/chatLanguageModels.json`

### 5. 设置开机自启（可选）

生成并加载 launchd plist：

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
