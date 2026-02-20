import { Honcho } from "@honcho-ai/sdk";
import { loadConfig, getSessionForPath, getSessionName, getHonchoClientOptions, isPluginEnabled, getCachedStdin } from "../config.js";
import { existsSync, readFileSync } from "fs";
import { getClaudeInstanceId } from "../cache.js";
import { logHook, logApiCall, setLogContext } from "../log.js";
import { outputStop, outputSystemMessage } from "../output.js";

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  stop_hook_active?: boolean;
  conversation_id?: string;
  generation_id?: string;
  model?: string;
  hook_event_name?: string;
  cursor_version?: string;
  workspace_roots?: string[];
  user_email?: string;
  status?: string;
  loop_count?: number;
}

interface TranscriptEntry {
  type?: string;
  role?: string;
  message?: {
    role?: string;
    content: string | Array<{ type: string; text?: string; name?: string; input?: any }>;
  };
  content?: string | Array<{ type: string; text?: string }>;
}

/**
 * Check if content is meaningful (not just tool announcements)
 */
function isMeaningfulContent(content: string): boolean {
  if (content.length < 50) return false;

  // Skip pure tool invocation announcements
  const toolAnnouncements = [
    /^(I'll|Let me|I'm going to|I will|Now I'll|First,? I'll)\s+(run|use|execute|check|read|look at|search|edit|write|create)/i,
  ];
  for (const pattern of toolAnnouncements) {
    if (pattern.test(content.trim()) && content.length < 200) {
      return false;
    }
  }

  return content.length >= 100;
}

/**
 * Extract the last assistant message from the transcript
 */
function getLastAssistantMessage(transcriptPath: string): string | null {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return null;
  }

  try {
    const content = readFileSync(transcriptPath, "utf-8");
    const lines = content.trim().split("\n").filter((line) => line.trim());

    // Read from the end to find the last assistant message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry: TranscriptEntry = JSON.parse(lines[i]);

        const entryType = entry.type || entry.role;
        const messageContent = entry.message?.content || entry.content;

        if (entryType === "assistant" && messageContent) {
          let assistantContent = "";

          if (typeof messageContent === "string") {
            assistantContent = messageContent;
          } else if (Array.isArray(messageContent)) {
            // Extract text blocks only (skip tool_use blocks)
            const textBlocks = messageContent
              .filter((p) => p.type === "text" && p.text)
              .map((p) => p.text!)
              .join("\n\n");

            assistantContent = textBlocks;
          }

          if (assistantContent && assistantContent.trim()) {
            return assistantContent;
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    // Failed to read transcript
  }

  return null;
}

export async function handleStop(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    process.exit(0);
  }

  // Early exit if plugin is disabled
  if (!isPluginEnabled()) {
    process.exit(0);
  }

  // Skip if message saving is disabled
  if (config.saveMessages === false) {
    process.exit(0);
  }

  let hookInput: HookInput = {};
  try {
    const input = getCachedStdin() ?? await Bun.stdin.text();
    if (input.trim()) {
      hookInput = JSON.parse(input);
    }
  } catch {
    process.exit(0);
  }

  // Claude Code: if stop_hook_active is true, we're in a continuation loop -- bail
  if (hookInput.stop_hook_active) {
    process.exit(0);
  }

  const cwd = hookInput.workspace_roots?.[0] || hookInput.cwd || process.env.CURSOR_PROJECT_DIR || process.cwd();
  const transcriptPath = hookInput.transcript_path;
  const sessionName = getSessionName(cwd);

  // Set log context
  setLogContext(cwd, sessionName);

  // Get the last assistant message from the transcript
  const lastMessage = getLastAssistantMessage(transcriptPath || "");

  if (!lastMessage || !isMeaningfulContent(lastMessage)) {
    logHook("stop", `Skipping (no meaningful content)`);
    outputStop();
    process.exit(0);
  }

  logHook("stop", `Capturing assistant response (${lastMessage.length} chars)`);

  try {
    const honcho = new Honcho(getHonchoClientOptions(config));

    // Get session and peer using fluent API
    const session = await honcho.session(sessionName);
    const aiPeer = await honcho.peer(config.aiPeer);

    // Upload the assistant response
    const instanceId = getClaudeInstanceId();
    logApiCall("session.addMessages", "POST", `assistant response (${lastMessage.length} chars)`);

    await session.addMessages([
      aiPeer.message(lastMessage.slice(0, 3000), {
        metadata: {
          instance_id: instanceId || undefined,
          type: "assistant_response",
          session_affinity: sessionName,
          model: hookInput.model || undefined,
          cursor_version: hookInput.cursor_version || undefined,
          user_email: hookInput.user_email || undefined,
          generation_id: hookInput.generation_id || undefined,
        },
      }),
    ]);

    logHook("stop", `Assistant response saved`);
    outputStop(`[honcho] response \u2192 saved response (${lastMessage.length} chars)`);
  } catch (error) {
    logHook("stop", `Upload failed: ${error}`, { error: String(error) });
    outputStop();
  }

  process.exit(0);
}
