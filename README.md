# Honcho Plugins

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Honcho](https://img.shields.io/badge/Honcho-Memory%20API-blue)](https://honcho.dev)

![Honcho x Cursor](assets/banner.png)

Give [Cursor](https://cursor.com) and [Claude Code](https://github.com/plastic-labs/claude-honcho) persistent memory powered by [Honcho](https://honcho.dev). Your AI assistant remembers what you're working on, your preferences, and what it was doing -- across context wipes, session restarts, and tab closures.

> **Claude Code users**: See [claude-honcho](https://github.com/plastic-labs/claude-honcho) for Claude Code-specific installation. The underlying plugin codebase is shared and host-aware.

## Plugins

| Plugin | Description |
|--------|-------------|
| **[honcho](#honcho-plugin)** | Persistent memory for Cursor sessions |
| **[honcho-dev](#honcho-dev-plugin)** | Skills for building AI apps with the Honcho SDK |

---

# `honcho` Plugin

## Prerequisites

1. **Bun** -- install with `curl -fsSL https://bun.sh/install | bash`
2. **Honcho API key** -- free at [app.honcho.dev](https://app.honcho.dev)

## Setup

### 1. Set your API key

Add to your shell config (`~/.zshrc` or `~/.bashrc`):

```bash
export HONCHO_API_KEY="hch-your-key-here"
```

Reload: `source ~/.zshrc`

### 2. Install dependencies

```bash
cd /path/to/cursor-honcho/plugins/honcho
bun install
```

### 3. Configure your project

In any project where you want Honcho memory, create a `.cursor/` directory with three things:

**`.cursor/hooks.json`** -- registers all 9 lifecycle hooks:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      { "command": "bun run /path/to/cursor-honcho/plugins/honcho/hooks/session-start.ts" }
    ],
    "sessionEnd": [
      { "command": "bun run /path/to/cursor-honcho/plugins/honcho/hooks/session-end.ts" }
    ],
    "beforeSubmitPrompt": [
      { "command": "bun run /path/to/cursor-honcho/plugins/honcho/hooks/before-submit-prompt.ts" }
    ],
    "postToolUse": [
      {
        "command": "bun run /path/to/cursor-honcho/plugins/honcho/hooks/post-tool-use.ts",
        "matcher": "Write|Edit|Shell|Task|MCP"
      }
    ],
    "preCompact": [
      { "command": "bun run /path/to/cursor-honcho/plugins/honcho/hooks/pre-compact.ts" }
    ],
    "stop": [
      { "command": "bun run /path/to/cursor-honcho/plugins/honcho/hooks/stop.ts" }
    ],
    "subagentStop": [
      { "command": "bun run /path/to/cursor-honcho/plugins/honcho/hooks/subagent-stop.ts" }
    ],
    "afterAgentThought": [
      { "command": "bun run /path/to/cursor-honcho/plugins/honcho/hooks/after-agent-thought.ts" }
    ],
    "afterAgentResponse": [
      { "command": "bun run /path/to/cursor-honcho/plugins/honcho/hooks/after-agent-response.ts" }
    ]
  }
}
```

Replace `/path/to/cursor-honcho` with the actual absolute path to this repo on your machine.

**`.cursor/mcp.json`** -- connects the MCP server for mid-conversation memory tools:

```json
{
  "mcpServers": {
    "honcho": {
      "command": "bun",
      "args": ["run", "/path/to/cursor-honcho/plugins/honcho/mcp-server.ts"]
    }
  }
}
```

**`.cursor/rules/honcho-memory.mdc`** -- the always-on memory rule:

```bash
cp /path/to/cursor-honcho/plugins/honcho/rules/honcho-memory.mdc .cursor/rules/
```

### 4. Open Cursor from the terminal

Launch Cursor from a terminal so it inherits `HONCHO_API_KEY`:

```bash
cursor /path/to/your-project
```

Open a new chat. If everything is configured, Honcho will inject memory context at session start.

### 5. Verify

- Open a new chat and check if the AI knows your name/preferences
- Run `/honcho:status` to see the connection status
- Run `/honcho:setup` for guided configuration if something isn't working

## Features

### Cross-Session Memory

Context about you, your preferences, and past work loads automatically at the start of every session. No re-explaining.

### Subagent Memory

When Cursor's subagents complete work, their results are saved to Honcho. Delegated research, code analysis, and background tasks all contribute to persistent memory.

### Deep Reasoning Capture

The `afterAgentThought` hook captures substantial AI reasoning (extended thinking blocks). When the AI does deep analysis, the insights are preserved for future sessions.

### MCP Tools

| Tool | Description |
|------|-------------|
| `search` | Semantic search across session messages |
| `chat` | Query Honcho's knowledge about the user |
| `create_conclusion` | Save insights about the user to memory |

### Commands

| Command | Description |
|---------|-------------|
| `/recall [topic]` | Search memory for something specific |
| `/remember [fact]` | Save something to persistent memory |
| `/honcho:interview` | Interview to capture preferences |
| `/honcho:status` | Show memory system status |
| `/honcho:setup` | Guided first-time configuration |

### Hook Events

| Hook | Purpose |
|------|---------|
| `sessionStart` | Load context from Honcho |
| `sessionEnd` | Upload messages and generate summary |
| `beforeSubmitPrompt` | Save messages, retrieve relevant context |
| `postToolUse` | Log tool activity to Honcho |
| `preCompact` | Anchor memory before context compaction |
| `stop` | Capture meaningful assistant responses |
| `subagentStop` | Save subagent results to memory |
| `afterAgentThought` | Capture deep reasoning |
| `afterAgentResponse` | Save assistant prose responses |

## Global Configuration

Honcho stores persistent config at `~/.honcho/config.json`. This is created automatically on first run, or you can edit it manually:

```json
{
  "apiKey": "hch-your-key-here",
  "peerName": "eri",
  "hosts": {
    "cursor": {
      "workspace": "cursor",
      "aiPeer": "cursor"
    },
    "claude_code": {
      "workspace": "claude_code",
      "aiPeer": "clawd"
    }
  }
}
```

Each host gets its own `workspace` and `aiPeer` identity. The `peerName` (your identity) is shared across hosts. If you use both [cursor-honcho](https://github.com/plastic-labs/cursor-honcho) and [claude-honcho](https://github.com/plastic-labs/claude-honcho), they read the same config file without conflicts.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HONCHO_API_KEY` | **Yes** | -- | Your Honcho API key from [app.honcho.dev](https://app.honcho.dev) |
| `HONCHO_PEER_NAME` | No | `$USER` | Your identity in the memory system |
| `HONCHO_WORKSPACE` | No | auto-detected | Workspace name (auto-detected from host) |
| `HONCHO_AI_PEER` | No | auto-detected | How the AI is identified (auto-detected from host) |
| `HONCHO_ENDPOINT` | No | `production` | `production`, `local`, or a custom URL |
| `HONCHO_ENABLED` | No | `true` | Set to `false` to disable |
| `HONCHO_SAVE_MESSAGES` | No | `true` | Set to `false` to stop saving messages |
| `HONCHO_LOGGING` | No | `true` | Set to `false` to disable file logging |

## Troubleshooting

### "Not configured" or no memory loading

1. Check your API key: `echo $HONCHO_API_KEY`
2. Make sure you opened Cursor from a terminal where the key is set
3. Run `/honcho:setup` for guided diagnostics

### MCP tools not available

1. Check `.cursor/mcp.json` exists in your project root with the correct absolute path
2. Restart Cursor after changing MCP config

### sessionStart context not loading

1. The hooks.json paths must be absolute (not relative)
2. Check Cursor's hook logs for JSON parse errors -- if you see ANSI escape codes in the output, update to the latest version which suppresses TTY output in non-interactive mode

### Using a local Honcho instance

```bash
export HONCHO_ENDPOINT="local"  # Uses localhost:8000
```

### Temporarily disabling

```bash
export HONCHO_ENABLED="false"
```

---

# `honcho-dev` Plugin

**Skills for building AI applications with the Honcho SDK.**

| Command | Description |
|---------|-------------|
| `/honcho-dev:integrate` | Add Honcho to your project |
| `/honcho-dev:migrate-py` | Migrate Python code to latest Honcho SDK |
| `/honcho-dev:migrate-ts` | Migrate TypeScript code to latest Honcho SDK |

---

## License

MIT -- see [LICENSE](LICENSE)

---

## Links

- **Issues**: [GitHub Issues](https://github.com/plastic-labs/cursor-honcho/issues)
- **Discord**: [Join the Community](https://discord.gg/plasticlabs)
- **X (Twitter)**: [@honchodotdev](https://x.com/honchodotdev)
- **Plastic Labs**: [plasticlabs.ai](https://plasticlabs.ai)
- **Honcho**: [honcho.dev](https://honcho.dev)
- **Documentation**: [docs.honcho.dev](https://docs.honcho.dev)
