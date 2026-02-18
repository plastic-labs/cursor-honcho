import { Honcho } from "@honcho-ai/sdk";
import { loadConfig, getSessionName, getHonchoClientOptions, isPluginEnabled } from "../config.js";
import { getClaudeInstanceId, appendClaudeWork } from "../cache.js";
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
  subagent_type?: string;
  status?: string;
  result?: string;
  duration?: number;
  agent_transcript_path?: string;
}

export async function handleSubagentStop(): Promise<void> {
  const config = loadConfig();
  if (!config || !isPluginEnabled() || config.saveMessages === false) {
    process.exit(0);
  }

  let hookInput: CursorHookInput = {};
  try {
    const input = await Bun.stdin.text();
    if (input.trim()) hookInput = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const cwd = hookInput.workspace_roots?.[0] || process.env.CURSOR_PROJECT_DIR || process.cwd();
  const subagentType = hookInput.subagent_type || "unknown";
  const status = hookInput.status || "unknown";
  const result = hookInput.result || "";
  const duration = hookInput.duration;

  setLogContext(cwd, getSessionName(cwd));

  // Only capture completed subagents with results
  if (status !== "completed" && status !== "success") {
    // Output empty JSON for Cursor
    console.log(JSON.stringify({}));
    process.exit(0);
  }

  // Build summary of what the subagent did
  const durationStr = duration ? ` (${Math.round(duration / 1000)}s)` : "";
  const resultPreview = result.length > 500 ? result.slice(0, 500) + "..." : result;
  const summary = `[Subagent ${subagentType}]${durationStr} ${resultPreview}`;

  logHook("subagent-stop", `Subagent ${subagentType} completed`, { status, duration });

  // Log to local context
  appendClaudeWork(`Subagent (${subagentType}): completed${durationStr}`);

  // Upload to Honcho
  try {
    const honcho = new Honcho(getHonchoClientOptions(config));
    const sessionName = getSessionName(cwd);
    const session = await honcho.session(sessionName);
    const cursorPeer = await honcho.peer(config.cursorPeer);
    const instanceId = getClaudeInstanceId();

    logApiCall("session.addMessages", "POST", `subagent result: ${subagentType}`);
    await session.addMessages([
      cursorPeer.message(summary, {
        metadata: {
          instance_id: instanceId || undefined,
          type: "subagent_result",
          subagent_type: subagentType,
          session_affinity: sessionName,
        },
      }),
    ]);
  } catch (error) {
    logHook("subagent-stop", `Upload failed: ${error}`, { error: String(error) });
  }

  // Output empty JSON for Cursor
  console.log(JSON.stringify({}));
  process.exit(0);
}
