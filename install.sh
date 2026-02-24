#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# Honcho Memory for Cursor — One-Line Installer
#
# curl -fsSL https://raw.githubusercontent.com/plastic-labs/cursor-honcho/main/install.sh | bash
#
# What this does:
#   1. Installs bun (if missing)
#   2. Clones cursor-honcho to ~/.honcho/plugins/cursor-honcho
#   3. Installs dependencies
#   4. Creates global ~/.cursor/hooks.json and mcp.json
#   5. Creates ~/.honcho/config.json
#   6. Validates API connection (if HONCHO_API_KEY is set)
# ──────────────────────────────────────────────────────────────────────
set -euo pipefail

BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
CYAN='\033[36m'
RESET='\033[0m'

HONCHO_DIR="$HOME/.honcho"
PLUGIN_DIR="$HONCHO_DIR/plugins/cursor-honcho"
PLUGIN_ROOT="$PLUGIN_DIR/plugins/honcho"
CURSOR_DIR="$HOME/.cursor"
REPO_URL="https://github.com/plastic-labs/cursor-honcho.git"

info()    { printf "  ${CYAN}>>>${RESET} %s\n" "$1"; }
success() { printf "  ${GREEN}>>>${RESET} %s\n" "$1"; }
warn()    { printf "  ${YELLOW}>>>${RESET} %s\n" "$1"; }
error()   { printf "  ${RED}>>>${RESET} %s\n" "$1"; }

printf "\n"
printf "  ${BOLD}honcho${RESET} ${DIM}memory for cursor${RESET}\n"
printf "  ${DIM}────────────────────${RESET}\n"
printf "\n"

# ── 1. Prerequisites ─────────────────────────────────────────────────

if ! command -v git &>/dev/null; then
  error "git is required but not installed"
  printf "  Install git first: https://git-scm.com\n"
  exit 1
fi

if ! command -v bun &>/dev/null; then
  info "Installing bun..."
  curl -fsSL https://bun.sh/install | bash 2>/dev/null
  # Source bun into this shell session
  if [ -f "$HOME/.bun/bin/bun" ]; then
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
  fi
  if ! command -v bun &>/dev/null; then
    error "Failed to install bun"
    printf "  Install manually: https://bun.sh\n"
    exit 1
  fi
  success "Bun installed ($(bun --version))"
else
  success "Bun found ($(bun --version))"
fi

# ── 2. Clone or update ──────────────────────────────────────────────

if [ -d "$PLUGIN_DIR/.git" ]; then
  info "Updating existing installation..."
  git -C "$PLUGIN_DIR" pull --quiet 2>/dev/null || true
  success "Updated"
else
  info "Cloning cursor-honcho..."
  mkdir -p "$(dirname "$PLUGIN_DIR")"
  git clone --quiet --depth 1 "$REPO_URL" "$PLUGIN_DIR"
  success "Cloned to $PLUGIN_DIR"
fi

# ── 3. Install dependencies ─────────────────────────────────────────

info "Installing dependencies..."
(cd "$PLUGIN_ROOT" && bun install --silent 2>/dev/null)
success "Dependencies installed"

# ── 4. API key check ────────────────────────────────────────────────

API_KEY_SET=false
if [ -n "${HONCHO_API_KEY:-}" ]; then
  API_KEY_SET=true
  success "HONCHO_API_KEY is set"
else
  warn "HONCHO_API_KEY is not set"
  printf "\n"
  printf "  ${BOLD}To get started:${RESET}\n"
  printf "  1. Get a free key at ${BOLD}https://app.honcho.dev${RESET}\n"
  printf "  2. Add to your shell config:\n"
  printf "\n"
  printf "     ${DIM}echo 'export HONCHO_API_KEY=\"hch-your-key\"' >> ~/.zshrc${RESET}\n"
  printf "     ${DIM}source ~/.zshrc${RESET}\n"
  printf "\n"
fi

# ── 5. Global hooks.json ────────────────────────────────────────────

HOOKS_FILE="$CURSOR_DIR/hooks.json"
HOOKS_DIR="$PLUGIN_ROOT/hooks"

generate_hooks() {
  cat <<EOF
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      { "command": "bun run $HOOKS_DIR/session-start.ts" }
    ],
    "sessionEnd": [
      { "command": "bun run $HOOKS_DIR/session-end.ts" }
    ],
    "beforeSubmitPrompt": [
      { "command": "bun run $HOOKS_DIR/before-submit-prompt.ts" }
    ],
    "postToolUse": [
      {
        "command": "bun run $HOOKS_DIR/post-tool-use.ts",
        "matcher": "Write|Edit|Shell|Task|MCP"
      }
    ],
    "preCompact": [
      { "command": "bun run $HOOKS_DIR/pre-compact.ts" }
    ],
    "stop": [
      { "command": "bun run $HOOKS_DIR/stop.ts" }
    ],
    "subagentStop": [
      { "command": "bun run $HOOKS_DIR/subagent-stop.ts" }
    ],
    "afterAgentThought": [
      { "command": "bun run $HOOKS_DIR/after-agent-thought.ts" }
    ],
    "afterAgentResponse": [
      { "command": "bun run $HOOKS_DIR/after-agent-response.ts" }
    ]
  }
}
EOF
}

mkdir -p "$CURSOR_DIR"

if [ -f "$HOOKS_FILE" ]; then
  if grep -q "honcho" "$HOOKS_FILE" 2>/dev/null; then
    info "Hooks already configured"
  else
    warn "Existing hooks.json found at $HOOKS_FILE"
    generate_hooks > "$HONCHO_DIR/cursor-hooks.json"
    info "Honcho hooks saved to $HONCHO_DIR/cursor-hooks.json"
    info "Merge manually into $HOOKS_FILE"
  fi
else
  generate_hooks > "$HOOKS_FILE"
  success "Created $HOOKS_FILE"
fi

# ── 6. Global mcp.json ──────────────────────────────────────────────

MCP_FILE="$CURSOR_DIR/mcp.json"
MCP_SERVER="$PLUGIN_ROOT/mcp-server.ts"

generate_mcp() {
  cat <<EOF
{
  "mcpServers": {
    "honcho": {
      "command": "bun",
      "args": ["run", "$MCP_SERVER"],
      "env": {
        "HONCHO_HOST": "cursor"
      }
    }
  }
}
EOF
}

if [ -f "$MCP_FILE" ]; then
  if grep -q "honcho" "$MCP_FILE" 2>/dev/null; then
    info "MCP server already configured"
  else
    if command -v jq &>/dev/null; then
      TEMP=$(mktemp)
      jq --arg server "$MCP_SERVER" \
        '.mcpServers.honcho = {"command": "bun", "args": ["run", $server]}' \
        "$MCP_FILE" > "$TEMP" && mv "$TEMP" "$MCP_FILE"
      success "Added honcho to existing $MCP_FILE"
    else
      warn "Existing mcp.json found at $MCP_FILE"
      generate_mcp > "$HONCHO_DIR/cursor-mcp.json"
      info "Honcho MCP config saved to $HONCHO_DIR/cursor-mcp.json"
      info "Merge manually into $MCP_FILE"
    fi
  fi
else
  generate_mcp > "$MCP_FILE"
  success "Created $MCP_FILE"
fi

# ── 7. Rules hint ────────────────────────────────────────────────────

RULES_SRC="$PLUGIN_ROOT/rules/honcho-memory.mdc"

# ── 8. Create config and validate ────────────────────────────────────

PEER_NAME="${HONCHO_PEER_NAME:-${USER:-user}}"
CONFIG_FILE="$HONCHO_DIR/config.json"

write_config() {
  cat <<CFGEOF
{
  "apiKey": "$HONCHO_API_KEY",
  "peerName": "$PEER_NAME",
  "saveMessages": true,
  "enabled": true,
  "logging": true,
  "hosts": {
    "cursor": {
      "workspace": "cursor",
      "aiPeer": "cursor"
    }
  }
}
CFGEOF
}

if [ "$API_KEY_SET" = true ]; then
  # Validate via SDK (API uses non-standard auth headers)
  info "Validating API key..."
  if (cd "$PLUGIN_ROOT" && bun -e '
    import { Honcho } from "@honcho-ai/sdk";
    const h = new Honcho({ apiKey: process.env.HONCHO_API_KEY, baseUrl: "https://api.honcho.dev/v3", workspaceId: "cursor" });
    await h.session("install-test");
    console.log("ok");
  ' 2>/dev/null | grep -q "ok"); then
    success "API key is valid"
  else
    warn "API key validation failed -- check your key at https://app.honcho.dev"
  fi

  # Write config
  if [ -f "$CONFIG_FILE" ]; then
    info "Config already exists at $CONFIG_FILE"
  else
    write_config > "$CONFIG_FILE"
    success "Created $CONFIG_FILE"
  fi
fi

# ── Done ─────────────────────────────────────────────────────────────

printf "\n"
printf "  ${BOLD}${GREEN}Installation complete${RESET}\n"
printf "  ${DIM}────────────────────${RESET}\n"
printf "\n"

if [ "$API_KEY_SET" = false ]; then
  printf "  ${BOLD}Next:${RESET}\n"
  printf "  1. Set HONCHO_API_KEY (see above)\n"
  printf "  2. Restart Cursor (launch from terminal)\n"
  printf "  3. Run ${DIM}/honcho:status${RESET} to verify\n"
else
  printf "  ${BOLD}Next:${RESET}\n"
  printf "  1. Restart Cursor (launch from terminal to inherit env)\n"
  printf "  2. Open a chat -- memory loads automatically\n"
  printf "  3. Run ${DIM}/honcho:status${RESET} to verify\n"
fi

printf "\n"
printf "  ${DIM}To add memory rules to a project:${RESET}\n"
printf "  ${DIM}mkdir -p .cursor/rules && cp $RULES_SRC .cursor/rules/${RESET}\n"
printf "\n"
printf "  ${DIM}Docs: https://github.com/plastic-labs/cursor-honcho${RESET}\n"
printf "  ${DIM}Help: https://discord.gg/plasticlabs${RESET}\n"
printf "\n"
