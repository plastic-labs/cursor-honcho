/**
 * Visual logging for honcho hooks - adapted for Cursor
 *
 * Cursor hooks output JSON with specific fields:
 * - sessionStart: { additional_context, env, user_message }
 * - beforeSubmitPrompt: { continue, user_message }
 * - preCompact: { user_message }
 * - stop: { followup_message }
 * - postToolUse: { updated_mcp_tool_output } (MCP only)
 */

import { arrows, symbols } from "./unicode.js";
import { isLoggingEnabled } from "./config.js";

const sym = {
  left: arrows.left,
  right: arrows.right,
  check: symbols.check,
  bullet: symbols.bullet,
  cross: symbols.cross,
};

type HookDirection = "in" | "out" | "info" | "ok" | "warn" | "error";

const directionSymbol: Record<HookDirection, string> = {
  in:    sym.left,
  out:   sym.right,
  info:  sym.bullet,
  ok:    sym.check,
  warn:  "!",
  error: sym.cross,
};

function formatLine(direction: HookDirection, hookName: string, message: string): string {
  return `[honcho] ${hookName} ${directionSymbol[direction]} ${message}`;
}

export function visContextLine(hookName: string, opts: {
  conclusions?: number;
  insights?: number;
  cached?: boolean;
  cacheAge?: number;
  sections?: number;
}): string {
  const parts: string[] = [];
  if (opts.conclusions) parts.push(`${opts.conclusions} conclusions`);
  if (opts.insights) parts.push(`${opts.insights} insights`);
  if (opts.sections) parts.push(`${opts.sections} sections`);

  let suffix = "";
  if (opts.cached) {
    const age = opts.cacheAge ? ` ${opts.cacheAge}s ago` : "";
    suffix = ` (cached${age})`;
  }

  if (parts.length > 0) {
    return formatLine("in", hookName, `injected ${parts.join(", ")}${suffix}`);
  }
  return "";
}

export function visCapture(summary: string): void {
  // In Cursor, postToolUse can't inject systemMessage for non-MCP tools
  // Log to stderr for TTY visibility
  process.stderr.write(`[honcho] post-tool-use ${sym.right} captured: ${summary}\n`);
}

export function visSkipMessage(hookName: string, reason: string): void {
  process.stderr.write(`[honcho] ${hookName} ${sym.bullet} skipped (${reason})\n`);
}

export function visStopMessage(direction: HookDirection, message: string): void {
  process.stderr.write(`[honcho] response ${directionSymbol[direction]} ${message}\n`);
}

// ============================================
// Verbose output - written to ~/.honcho/verbose.log
// ============================================

import { homedir } from "os";
import { join } from "path";
import { appendFileSync, mkdirSync, existsSync, writeFileSync } from "fs";

const VERBOSE_LOG = join(homedir(), ".honcho", "verbose.log");

function ensureVerboseLog(): void {
  const dir = join(homedir(), ".honcho");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeVerbose(text: string): void {
  if (!isLoggingEnabled()) return;
  ensureVerboseLog();
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  appendFileSync(VERBOSE_LOG, `[${timestamp}] ${text}\n`);
}

export function verboseApiResult(label: string, data: string | null | undefined): void {
  if (!data) return;
  const separator = "\u2500".repeat(60);
  const content = data.length > 3000 ? data.slice(0, 3000) + `\n... (${data.length - 3000} more chars)` : data;
  writeVerbose(`${label}\n${separator}\n${content}\n${separator}`);
}

export function verboseList(label: string, items: string[] | null | undefined): void {
  if (!items || items.length === 0) return;
  const formatted = items.map(item => `  \u2022 ${item}`).join("\n");
  writeVerbose(`${label} (${items.length} items)\n${formatted}`);
}

export function clearVerboseLog(): void {
  if (!isLoggingEnabled()) return;
  ensureVerboseLog();
  writeFileSync(VERBOSE_LOG, "");
}

export function getVerboseLogPath(): string {
  return VERBOSE_LOG;
}

export function formatVerboseBlock(label: string, data: string | null | undefined): string {
  if (!data) return "";
  const separator = "\u2500".repeat(60);
  const content = data.length > 3000 ? data.slice(0, 3000) + `\n... (${data.length - 3000} more chars)` : data;
  return `\n[verbose] ${label}\n${separator}\n${content}\n${separator}`;
}

export function formatVerboseList(label: string, items: string[] | null | undefined): string {
  if (!items || items.length === 0) return "";
  const formatted = items.map(item => `  \u2022 ${item}`).join("\n");
  return `\n[verbose] ${label} (${items.length} items)\n${formatted}`;
}
