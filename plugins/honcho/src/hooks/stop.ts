import { loadConfig, getSessionName, isPluginEnabled, getCachedStdin } from "../config.js";
import { logHook, setLogContext } from "../log.js";
import { outputStop } from "../output.js";

interface HookInput {
  cwd?: string;
  stop_hook_active?: boolean;
  workspace_roots?: string[];
}

export async function handleStop(): Promise<void> {
  const config = loadConfig();
  if (!config || !isPluginEnabled()) {
    process.exit(0);
  }

  let hookInput: HookInput = {};
  try {
    const input = getCachedStdin() ?? await Bun.stdin.text();
    if (input.trim()) hookInput = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  // Claude Code: if stop_hook_active is true, we're in a continuation loop -- bail
  if (hookInput.stop_hook_active) {
    process.exit(0);
  }

  const cwd = hookInput.workspace_roots?.[0] || hookInput.cwd || process.env.CURSOR_PROJECT_DIR || process.cwd();
  const sessionName = getSessionName(cwd);
  setLogContext(cwd, sessionName);

  // Assistant response upload is handled by afterAgentResponse hook.
  // Stop hook only handles cleanup and output.
  logHook("stop", "Session stop");
  outputStop();

  process.exit(0);
}
