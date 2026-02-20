# Honcho

Persistent memory for [Cursor](https://cursor.com) sessions powered by [Honcho](https://honcho.dev). Your AI assistant remembers what you're working on, your preferences, and what it was doing -- across context wipes, session restarts, and tab closures.

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

### 3. Install the plugin

Use `/add-plugin honcho` in Cursor, or manually configure `.cursor/hooks.json`, `.cursor/mcp.json`, and `.cursor/rules/honcho-memory.mdc` in your project. See the [repo README](https://github.com/plastic-labs/cursor-honcho#honcho-plugin) for detailed manual setup.

### 4. Verify

- Open a new chat and check if the AI references your name/preferences
- Run `/honcho:status` to see connection status
- Run `/honcho:setup` for guided configuration if something isn't working

## Components

### Skills

| Skill | Description |
|-------|-------------|
| `/honcho:setup` | Guided first-time configuration |
| `/honcho:status` | Show memory system status |
| `/honcho:interview` | Interview to capture preferences |

### Rules

| Rule | Description |
|------|-------------|
| `honcho-memory` | Always-on rule that tells the agent to leverage persistent memory |

### Agents

| Agent | Description |
|-------|-------------|
| `memory-analyst` | Deep memory queries and analysis |

### Commands

| Command | Description |
|---------|-------------|
| `/recall [topic]` | Search memory for something specific |
| `/remember [fact]` | Save something to persistent memory |

### MCP Tools

| Tool | Description |
|------|-------------|
| `search` | Semantic search across session messages |
| `chat` | Query Honcho's knowledge about the user |
| `create_conclusion` | Save insights about the user to memory |

### Hooks

| Hook | Purpose |
|------|---------|
| `sessionStart` | Load context from Honcho |
| `sessionEnd` | Upload messages and generate summary |
| `beforeSubmitPrompt` | Save messages, retrieve relevant context |
| `postToolUse` | Log tool activity |
| `preCompact` | Anchor memory before context compaction |
| `stop` | Capture meaningful assistant responses |
| `subagentStop` | Save subagent results |
| `afterAgentThought` | Capture deep reasoning |
| `afterAgentResponse` | Save assistant prose responses |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HONCHO_API_KEY` | **Yes** | -- | API key from [app.honcho.dev](https://app.honcho.dev) |
| `HONCHO_PEER_NAME` | No | `$USER` | Your identity in the memory system |
| `HONCHO_WORKSPACE` | No | auto-detected | Workspace name |
| `HONCHO_AI_PEER` | No | auto-detected | AI identity |
| `HONCHO_ENDPOINT` | No | `production` | `production`, `local`, or a custom URL |
| `HONCHO_ENABLED` | No | `true` | Set to `false` to disable |

## License

MIT
