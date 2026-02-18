import { Honcho } from "@honcho-ai/sdk";
import { loadConfig, getSessionForPath, getSessionName, getHonchoClientOptions, isPluginEnabled } from "../config.js";
import { existsSync, readFileSync } from "fs";
import { getInstanceId } from "../cache.js";
import { logHook, logApiCall, setLogContext } from "../log.js";

interface CursorHookInput {
  conversation_id?: string;
  session_id?: string;
  generation_id?: string;
  model?: string;
  hook_event_name?: string;
  cursor_version?: string;
  workspace_roots?: string[];
  user_email?: string;
  transcript_path?: string;
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

  let hookInput: CursorHookInput = {};
  try {
    const input = await Bun.stdin.text();
    if (input.trim()) {
      hookInput = JSON.parse(input);
    }
  } catch {
    process.exit(0);
  }

  const cwd = hookInput.workspace_roots?.[0] || process.env.CURSOR_PROJECT_DIR || process.cwd();
  const transcriptPath = hookInput.transcript_path;
  const sessionName = getSessionName(cwd);

  // Set log context
  setLogContext(cwd, sessionName);

  // Get the last assistant message from the transcript
  const lastMessage = getLastAssistantMessage(transcriptPath || "");

  if (!lastMessage || !isMeaningfulContent(lastMessage)) {
    logHook("stop", `Skipping (no meaningful content)`);
    // Output empty JSON - don't output followup_message to avoid auto-loops
    console.log(JSON.stringify({}));
    process.exit(0);
  }

  logHook("stop", `Capturing assistant response (${lastMessage.length} chars)`);

  try {
    const honcho = new Honcho(getHonchoClientOptions(config));

    // Get session and peer using fluent API
    const session = await honcho.session(sessionName);
    const cursorPeer = await honcho.peer(config.cursorPeer);

    // Upload the assistant response
    const instanceId = getInstanceId();
    logApiCall("session.addMessages", "POST", `assistant response (${lastMessage.length} chars)`);

    await session.addMessages([
      cursorPeer.message(lastMessage.slice(0, 3000), {
        metadata: {
          instance_id: instanceId || undefined,
          model: hookInput.model,
          type: "assistant_response",
          session_affinity: sessionName,
        },
      }),
    ]);

    logHook("stop", `Assistant response saved`);
  } catch (error) {
    logHook("stop", `Upload failed: ${error}`, { error: String(error) });
  }

  // Output empty JSON - don't output followup_message to avoid auto-loops
  console.log(JSON.stringify({}));
  process.exit(0);
}
