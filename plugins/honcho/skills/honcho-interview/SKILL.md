---
name: honcho-interview
description: Interview the user to capture stable, cross-project preferences and save them to Honcho
allowed-tools: chat, create_conclusion
user-invocable: true
---

# Honcho Interview

Learn stable, cross-project aspects of the user and store them in Honcho memory.

## Guardrails

- Focus on global traits that are unlikely to change between projects.
- Avoid project-specific topics, credentials, addresses, or other sensitive information.
- If an answer is vague, ask one brief clarification before saving a conclusion.
- If the user declines to answer, skip that topic and move on.
- Use existing knowledge to avoid repeating questions the memory already covers.

## Step 1: Gather Context

Before asking anything, do two things in parallel:

1. **Check existing memory**: Use the `chat` tool to ask what is already known about the user.
2. **Scan the environment**: Check for files that reveal preferences:
   - `~/.claude/CLAUDE.md` or `.claude/CLAUDE.md` — explicit user instructions
   - `package.json` — detect package manager (bun/npm/yarn/pnpm)
   - `.editorconfig`, `.prettierrc`, `tsconfig.json` — code style
   - Shell config (`~/.zshrc`, `~/.bashrc`) — OS, shell, env vars
   - `.python-version`, `pyproject.toml` — Python tooling

## Step 2: Present Findings

Show the user a single summary of everything detected:

```
Here's what I know so far:
- OS/Shell: macOS, zsh
- Package managers: bun (JS), uv (Python)
- Code style: TypeScript, strict mode
- [any preferences from existing memory]

What I still need to know:
- Communication style (concise vs detailed)
- Code quality priority (clarity, performance, tests)
- Collaboration style (direct changes vs propose first)
```

## Step 3: Fill Gaps (Batch)

Present ALL remaining unknowns as a single numbered list. The user can answer them all at once in one message rather than going back and forth 8 times.

The full set of preferences to cover (skip any already answered by Step 1):

1. Communication style: concise answers, detailed explanations, or a mix?
2. Tone: direct/professional or conversational?
3. Structure: bullet points, step-by-step, or narrative?
4. Technical depth: beginner, intermediate, or expert?
5. Learning preference: explanations first, examples first, or both?
6. Code quality focus: clarity, performance, tests, or minimal changes?
7. Collaboration style: make changes directly, propose options, or ask first?
8. Environment: OS, shell, package managers, editors?

Example prompt:

> I have 4 remaining questions. You can answer them all at once -- just number your answers:
>
> 1. Communication style: concise, detailed, or mix?
> 2. Code quality: what matters most -- clarity, performance, tests?
> 3. Collaboration: direct changes, propose options, or ask first?
> 4. Anything else worth knowing?

## Saving Conclusions

After the user responds, save one `create_conclusion` per distinct preference. Guidelines:

- Use a single sentence per conclusion.
- Make it specific and unambiguous.
- Avoid hedging if the user gives a clear preference.
- Save conclusions from the environment scan too (package managers, OS, etc.)

## Wrap-up

Briefly recap all conclusions saved and ask if anything should be corrected. Only save a new conclusion if the user explicitly corrects something.
