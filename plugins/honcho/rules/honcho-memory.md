---
description: Honcho persistent memory system is active. The agent has cross-session memory and should leverage it.
alwaysApply: true
---

# Honcho Memory

You have persistent memory via Honcho. Context about the user, their preferences, and past work is loaded automatically at the start of every session.

## How to use it:

- Trust the Honcho context injected at session start. It contains what you know about the user - act on it.
- Use `chat` or `search` MCP tools mid-conversation when you need context beyond what was loaded at startup.
- Use `create_conclusion` to save new insights as you learn them: preferences, decisions, patterns, things the user has asked you not to do.
- The user should never have to repeat themselves. If you've learned something before, you should already know it.
- When delegating to subagents, the memory-analyst agent can perform deep memory queries for you.

## Memory-aware behaviors:

- Before asking the user a preference question, check if you already know the answer from loaded context.
- When you discover a new user preference or pattern, save it with `create_conclusion`.
- Reference past work naturally ("Last time we worked on X, you preferred Y...").
- If context seems stale or you need deeper history, use the search tool.
