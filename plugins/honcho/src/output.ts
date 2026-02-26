/**
 * Host-aware output adapter for hook responses.
 *
 * The business logic in every hook is identical across hosts.
 * Only the final output format differs:
 *
 * Claude Code:
 *   SessionStart     -> plain text to stdout (pixel art + context)
 *   UserPromptSubmit -> { hookSpecificOutput: { hookEventName, additionalContext }, systemMessage }
 *   Stop             -> { systemMessage } or silent exit
 *   PostToolUse      -> { systemMessage }
 *   PreCompact       -> plain text to stdout (memory anchor)
 *
 * Cursor:
 *   sessionStart        -> { additional_context, user_message }
 *   beforeSubmitPrompt  -> { continue: true, user_message }
 *   stop                -> {} (empty -- no followup_message to avoid auto-loops)
 *   postToolUse         -> stderr only (can't inject for non-MCP tools)
 *   preCompact          -> { user_message }
 */

import { getDetectedHost, type HonchoHost } from "./config.js";

// ============================================
// Session Start
// ============================================

export interface SessionStartOutput {
  memoryContext: string;     // Full context block (markdown)
  statusLine: string;        // Short status summary
  aiPeer: string;            // AI peer name for header
  showPixelArt: boolean;     // Whether to show pixel art (TTY + not background)
}

export function outputSessionStart(data: SessionStartOutput): void {
  const host = getDetectedHost();

  if (host === "cursor") {
    const output = {
      additional_context: `[${data.aiPeer}/Honcho Memory Loaded]\n\n${data.memoryContext}`,
      user_message: data.statusLine,
    };
    console.log(JSON.stringify(output));
  } else {
    // Claude Code: pixel art is handled by caller before this function
    // Output plain text that becomes part of the visible context
    console.log(`\n[${data.aiPeer}/Honcho Memory Loaded]\n\n${data.memoryContext}`);
  }
}

export function outputSessionStartSetup(message: string, statusLine: string): void {
  const host = getDetectedHost();

  if (host === "cursor") {
    console.log(JSON.stringify({
      additional_context: message,
      user_message: statusLine,
    }));
  } else {
    // Claude Code: plain text
    console.log(message);
  }
}

// ============================================
// User Prompt / Before Submit Prompt
// ============================================

export interface PromptContextOutput {
  peerName: string;
  aiPeer: string;
  contextParts: string[];
  systemMsg?: string;        // Status line (e.g. "injected 5 conclusions")
}

export function outputPromptContext(data: PromptContextOutput): void {
  const host = getDetectedHost();
  const contextText = `[Honcho Memory for ${data.peerName}]: ${data.contextParts.join(" | ")}`;

  if (host === "cursor") {
    console.log(JSON.stringify({
      continue: true,
      user_message: contextText,
    }));
  } else {
    // Claude Code: hookSpecificOutput with additionalContext
    const output: any = {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: contextText,
      },
    };
    if (data.systemMsg) {
      output.systemMessage = data.systemMsg;
    }
    console.log(JSON.stringify(output));
  }
}

export function outputPromptContinue(systemMsg?: string): void {
  const host = getDetectedHost();

  if (host === "cursor") {
    console.log(JSON.stringify({ continue: true }));
  } else {
    if (systemMsg) {
      console.log(JSON.stringify({ systemMessage: systemMsg }));
    }
    // Claude Code: no output needed if no system message
  }
}

// ============================================
// Stop
// ============================================

export function outputStop(systemMsg?: string): void {
  const host = getDetectedHost();

  if (host === "cursor") {
    // Empty JSON -- no followup_message to avoid auto-loops
    console.log(JSON.stringify({}));
  } else {
    // Claude Code: systemMessage for visibility, or silent exit
    if (systemMsg) {
      console.log(JSON.stringify({ systemMessage: systemMsg }));
    }
  }
}

// ============================================
// Post Tool Use
// ============================================

export function outputToolCapture(summary: string): void {
  const host = getDetectedHost();

  if (host === "cursor") {
    // Cursor: postToolUse can't inject systemMessage for non-MCP tools
    // Log to stderr for TTY visibility
    process.stderr.write(`[honcho] post-tool-use \u2192 captured: ${summary}\n`);
  } else {
    // Claude Code: systemMessage JSON
    console.log(JSON.stringify({
      systemMessage: `[honcho] post-tool-use \u2192 captured: ${summary}`,
    }));
  }
}

// ============================================
// Pre-Compact
// ============================================

export function outputPreCompact(aiPeer: string, memoryCard: string, verboseOutput?: string): void {
  const host = getDetectedHost();

  if (host === "cursor") {
    console.log(JSON.stringify({
      user_message: `[${aiPeer}/Honcho Memory Anchor]\n\n${memoryCard}`,
    }));
  } else {
    // Claude Code: plain text to stdout (shown in Ctrl+O)
    const suffix = verboseOutput ? verboseOutput : "";
    console.log(`[${aiPeer}/Honcho Memory Anchor]\n\n${memoryCard}${suffix}`);
  }
}

// ============================================
// Generic helpers
// ============================================

/** Output a status/skip/info message to the appropriate channel */
export function outputSystemMessage(hookName: string, message: string): void {
  const host = getDetectedHost();
  const line = `[honcho] ${hookName} \u2022 ${message}`;

  if (host === "cursor") {
    process.stderr.write(`${line}\n`);
  } else {
    console.log(JSON.stringify({ systemMessage: line }));
  }
}
