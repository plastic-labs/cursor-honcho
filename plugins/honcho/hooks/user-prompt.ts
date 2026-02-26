#!/usr/bin/env bun
/**
 * Claude Code entry point for UserPromptSubmit hook.
 * Same handler as before-submit-prompt.ts (Cursor's name).
 */
import { detectHost, setDetectedHost, cacheStdin } from "../src/config.js";
import { handleBeforeSubmitPrompt } from "../src/hooks/before-submit-prompt.js";

const stdinText = await Bun.stdin.text();
cacheStdin(stdinText);
let input = {};
try { input = JSON.parse(stdinText || "{}"); } catch { /* malformed stdin */ }
setDetectedHost(detectHost(input));
await handleBeforeSubmitPrompt();
