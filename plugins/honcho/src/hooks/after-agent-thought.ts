import { Honcho } from "@honcho-ai/sdk";
import { loadConfig, getSessionName, getHonchoClientOptions, isPluginEnabled, getCachedStdin } from "../config.js";
import { getClaudeInstanceId } from "../cache.js";
import { logHook, setLogContext } from "../log.js";

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
  text?: string;
  duration_ms?: number;
}

export async function handleAfterAgentThought(): Promise<void> {
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
  const durationMs = hookInput.duration_ms;

  setLogContext(cwd, getSessionName(cwd));

  // Only capture substantial reasoning (>500 chars, >3 seconds)
  if (text.length < 500 || (durationMs && durationMs < 3000)) {
    process.exit(0);
  }

  logHook("after-agent-thought", `Capturing deep reasoning (${text.length} chars, ${durationMs}ms)`);

  try {
    const honcho = new Honcho(getHonchoClientOptions(config));
    const sessionName = getSessionName(cwd);
    const session = await honcho.session(sessionName);
    const aiPeer = await honcho.peer(config.aiPeer);
    const instanceId = getClaudeInstanceId();

    // Truncate to avoid API limits but keep the valuable reasoning
    const truncated = text.length > 4000 ? text.slice(0, 4000) + "..." : text;

    await session.addMessages([
      aiPeer.message(`[Reasoning] ${truncated}`, {
        metadata: {
          instance_id: instanceId || undefined,
          type: "agent_thought",
          duration_ms: durationMs,
          session_affinity: sessionName,
        },
      }),
    ]);
  } catch (error) {
    logHook("after-agent-thought", `Upload failed: ${error}`, { error: String(error) });
  }

  process.exit(0);
}
