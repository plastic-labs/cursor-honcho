import { Honcho } from "@honcho-ai/sdk";
import { loadConfig, getSessionName, getHonchoClientOptions, isPluginEnabled, getCachedStdin } from "../config.js";
import { getInstanceId } from "../cache.js";
import { logHook, logApiCall, setLogContext } from "../log.js";

interface CursorHookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  text?: string;
  conversation_id?: string;
  generation_id?: string;
  model?: string;
  hook_event_name?: string;
  cursor_version?: string;
  workspace_roots?: string[];
  user_email?: string;
}

function isMeaningfulContent(content: string): boolean {
  if (content.length < 50) return false;
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

export async function handleAfterAgentResponse(): Promise<void> {
  const config = loadConfig();
  if (!config || !isPluginEnabled() || config.saveMessages === false) {
    process.exit(0);
  }

  let hookInput: CursorHookInput = {};
  try {
    const input = getCachedStdin() ?? await Bun.stdin.text();
    if (input.trim()) hookInput = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const cwd = hookInput.workspace_roots?.[0] || hookInput.cwd || process.env.CURSOR_PROJECT_DIR || process.cwd();
  const text = hookInput.text || "";

  setLogContext(cwd, getSessionName(cwd));

  if (!isMeaningfulContent(text)) {
    process.exit(0);
  }

  logHook("after-agent-response", `Capturing response (${text.length} chars)`);

  try {
    const honcho = new Honcho(getHonchoClientOptions(config));
    const sessionName = getSessionName(cwd);
    const session = await honcho.session(sessionName);
    const aiPeer = await honcho.peer(config.aiPeer);
    const instanceId = getInstanceId();

    logApiCall("session.addMessages", "POST", `response (${text.length} chars)`);
    await session.addMessages([
      aiPeer.message(text.slice(0, 3000), {
        metadata: {
          instance_id: instanceId || undefined,
          type: "assistant_response",
          session_affinity: sessionName,
        },
      }),
    ]);
  } catch (error) {
    logHook("after-agent-response", `Upload failed: ${error}`, { error: String(error) });
  }

  process.exit(0);
}
