#!/usr/bin/env bash
# install.sh — Bootstrap DeepSeek proxy for GitHub Copilot on macOS.
# Usage: ./install.sh
set -euo pipefail

DEFAULT_PROXY_DIR="$HOME/deepseek-proxy"
CODELAB_MODELS_FILE="$HOME/Library/Application Support/Code/User/chatLanguageModels.json"
VSCODE_INSIDERS_MODELS_FILE="$HOME/Library/Application Support/Code - Insiders/User/chatLanguageModels.json"
CURSOR_MODELS_FILE="$HOME/Library/Application Support/Cursor/User/chatLanguageModels.json"
PLIST_PATH="$HOME/Library/LaunchAgents/com.local.deepseek-proxy.plist"

echo ""
echo "═══════════════════════════════════════════════"
echo "  DeepSeek Proxy for GitHub Copilot Installer"
echo "═══════════════════════════════════════════════"
echo ""

# ── Step 1: DeepSeek API Key ──────────────────────────────────────────
echo "This proxy forwards Copilot requests to api.deepseek.com."
echo "You need a DeepSeek API key. Get one at: https://platform.deepseek.com/api_keys"
echo ""
read -rp "Enter your DeepSeek API key (sk-...): " DEEPSEEK_KEY
if [[ -z "$DEEPSEEK_KEY" ]]; then
  echo "ERROR: API key is required."
  exit 1
fi

# ── Step 2: Proxy directory ───────────────────────────────────────────
read -rp "Proxy directory [$DEFAULT_PROXY_DIR]: " PROXY_DIR
PROXY_DIR="${PROXY_DIR:-$DEFAULT_PROXY_DIR}"
mkdir -p "$PROXY_DIR/logs"

# ── Step 3: Install Bun (if needed) ───────────────────────────────────
if command -v bun &>/dev/null; then
  BUN_PATH="$(command -v bun)"
  echo "✔ bun found at $BUN_PATH"
else
  echo "Bun not found, installing..."
  curl -fsSL https://bun.sh/install | bash
  # bun install script adds to ~/.zshrc or ~/.bashrc; source for this session
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  # Determine bun path
  if command -v bun &>/dev/null; then
    BUN_PATH="$(command -v bun)"
  else
    BUN_PATH="$HOME/.bun/bin/bun"
  fi
  echo "✔ bun installed at $BUN_PATH"
fi

# Resolve real path in case it's a symlink or homebrew alias
BUN_PATH="$(realpath "$(command -v bun)" 2>/dev/null || echo "$(command -v bun)")"
BUN_DIR="$(dirname "$BUN_PATH")"

# ── Step 4: Copy proxy script ─────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/proxy.ts" "$PROXY_DIR/proxy.ts"
echo "✔ proxy.ts → $PROXY_DIR/proxy.ts"

# ── Step 5: Generate launchd plist ────────────────────────────────────
mkdir -p "$(dirname "$PLIST_PATH")"
sed \
  -e "s|__BUN_PATH__|$BUN_PATH|g" \
  -e "s|__PROXY_DIR__|$PROXY_DIR|g" \
  -e "s|__DEEPSEEK_API_KEY__|$DEEPSEEK_KEY|g" \
  -e "s|__BUN_DIR__|$BUN_DIR|g" \
  -e "s|__USER_HOME__|$HOME|g" \
  "$SCRIPT_DIR/com.local.deepseek-proxy.plist.template" \
  > "$PLIST_PATH"
echo "✔ launchd plist → $PLIST_PATH"

# ── Step 6: Unload old / load new ─────────────────────────────────────
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"
echo "✔ proxy launched and set to auto-start on boot"

# ── Step 7: Configure Copilot model definition ────────────────────────
echo ""
echo "── Copilot Model Configuration ───────────────"

# Determine which editor(s) the user has
merge_model_for() {
  local target="$1"
  local label="$2"
  local dir
  dir="$(dirname "$target")"
  if [[ ! -d "$dir" ]]; then
    return 1
  fi
  if [[ -f "$target" ]]; then
    # Check if deepseek-v4-pro is already in the file
    if grep -q '"deepseek-v4-pro"' "$target" 2>/dev/null; then
      echo "   [$label] already has deepseek-v4-pro entry — skipping"
    else
      echo "   [$label] found, merging deepseek-v4-pro entry..."
      # Insert the model entry: use jq if available, else python3, else warn
      if command -v jq &>/dev/null; then
        local tmp
        tmp="$(mktemp)"
        jq --argjson newEntry '{"name":"deepseek-v4-pro","vendor":"ollama","url":"http://[::1]:8765"}' \
          '. + [$newEntry]' "$target" > "$tmp" && mv "$tmp" "$target"
        echo "   ✔ merged into $label"
      elif command -v python3 &>/dev/null; then
        python3 -c "
import json, sys
with open('$target', 'r') as f:
    data = json.load(f)
entry = {'name': 'deepseek-v4-pro', 'vendor': 'ollama', 'url': 'http://[::1]:8765'}
if not any(e.get('name') == 'deepseek-v4-pro' for e in data):
    data.append(entry)
with open('$target', 'w') as f:
    json.dump(data, f, indent='\t')
f.write('\n')
"
        echo "   ✔ merged into $label"
      else
        echo "   ⚠  jq or python3 not found. Manually merge:"
        echo "      $target"
        echo "      Add entry: {\"name\":\"deepseek-v4-pro\",\"vendor\":\"ollama\",\"url\":\"http://[::1]:8765\"}"
      fi
    fi
  elif [[ ! -d "$dir" ]]; then
    return 2  # editor not installed
  else
    # File doesn't exist, create it with both Copilot + deepseek entries
    cat > "$target" <<'ENDCONFIG'
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
ENDCONFIG
    echo "   ✔ created $label config with deepseek-v4-pro entry"
  fi
}

set +e
merge_model_for "$CODELAB_MODELS_FILE" "VS Code"
merge_model_for "$VSCODE_INSIDERS_MODELS_FILE" "VS Code Insiders"
merge_model_for "$CURSOR_MODELS_FILE" "Cursor"
set -e

# ── Step 8: Verify proxy is running ───────────────────────────────────
echo ""
echo "── Verification ──────────────────────────────"
sleep 1
if curl -sf --max-time 3 http://localhost:8765/api/version > /dev/null 2>&1; then
  echo "✔ Proxy is running at http://localhost:8765"
elif curl -sf --max-time 3 'http://[::1]:8765/api/version' > /dev/null 2>&1; then
  echo "✔ Proxy is running at http://[::1]:8765"
else
  echo "⚠  Proxy may not have started yet. Check logs:"
  echo "   tail -f $PROXY_DIR/logs/out.log"
fi

echo ""
echo "═══════════════════════════════════════════════"
echo "  Installation complete!"
echo ""
echo "  Restart VS Code, then select model:"
echo "    Cmd+Shift+P → 'Chat: Switch Model' → deepseek-v4-pro"
echo ""
echo "  Logs:  tail -f $PROXY_DIR/logs/out.log"
echo "  Stop:  launchctl unload $PLIST_PATH"
echo "  Start: launchctl load $PLIST_PATH"
echo "═══════════════════════════════════════════════"
