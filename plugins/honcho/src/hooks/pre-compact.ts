import { Honcho } from "@honcho-ai/sdk";
import { loadConfig, getSessionForPath, getSessionName, getHonchoClientOptions, isPluginEnabled } from "../config.js";
import { Spinner } from "../spinner.js";
import { logHook, logApiCall, setLogContext } from "../log.js";
import { formatVerboseBlock, formatVerboseList } from "../visual.js";

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
  trigger?: "manual" | "auto";
  context_usage_percent?: number;
  context_tokens?: number;
  context_window_size?: number;
  message_count?: number;
  messages_to_compact?: number;
  is_first_compaction?: boolean;
}

/**
 * Format a compact memory card that survives summarization
 * This is injected RIGHT BEFORE compaction so it becomes part of the summary
 */
function formatMemoryCard(
  config: { peerName: string; cursorPeer: string; workspace: string },
  sessionName: string,
  userContext: any,
  cursorContext: any,
  summaries: any,
  userDialectic: string | null,
  cursorDialectic: string | null
): string {
  const parts: string[] = [];

  // Header - identity anchor
  parts.push(`## HONCHO MEMORY ANCHOR (Pre-Compaction Injection)
This context is being injected because the conversation is about to be summarized.
These conclusions MUST be preserved in the summary.

### Session Identity
- User: ${config.peerName}
- AI: ${config.cursorPeer}
- Workspace: ${config.workspace}
- Session: ${sessionName}`);

  // User profile - critical to preserve
  const userPeerCard = userContext?.peerCard;
  if (userPeerCard?.length > 0) {
    parts.push(`### ${config.peerName}'s Profile (PRESERVE)
${userPeerCard.join("\n")}`);
  }

  // Key user conclusions
  const userRep = userContext?.representation;
  if (typeof userRep === "string" && userRep.trim()) {
    parts.push(`### Key Conclusions About ${config.peerName} (PRESERVE)\n${userRep}`);
  }

  // Cursor's self-context - what was it working on
  const cursorRep = cursorContext?.representation;
  if (typeof cursorRep === "string" && cursorRep.trim()) {
    parts.push(`### ${config.cursorPeer}'s Recent Work (PRESERVE)\n${cursorRep}`);
  }

  // Session summary - what we were doing
  const shortSummary = summaries?.shortSummary;
  if (shortSummary?.content) {
    parts.push(`### Session Context (PRESERVE)
${shortSummary.content}`);
  }

  // Fresh dialectic insights - expensive but worth it at compaction time
  if (userDialectic) {
    parts.push(`### AI Understanding of ${config.peerName} (PRESERVE)
${userDialectic}`);
  }

  if (cursorDialectic) {
    parts.push(`### ${config.cursorPeer}'s Self-Reflection (PRESERVE)
${cursorDialectic}`);
  }

  parts.push(`### End Memory Anchor
The above context represents persistent memory from Honcho.
When summarizing this conversation, ensure these conclusions are preserved.`);

  return parts.join("\n\n");
}

export async function handlePreCompact(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    // No config, nothing to inject
    process.exit(0);
  }

  // Early exit if plugin is disabled
  if (!isPluginEnabled()) {
    process.exit(0);
  }

  let hookInput: CursorHookInput = {};
  try {
    const input = await Bun.stdin.text();
    if (input.trim()) {
      hookInput = JSON.parse(input);
    }
  } catch {
    // No input, continue with defaults
  }

  const cwd = hookInput.workspace_roots?.[0] || process.env.CURSOR_PROJECT_DIR || process.cwd();
  const trigger = hookInput.trigger || "auto";
  const isFirstCompaction = hookInput.is_first_compaction;

  // Set log context
  setLogContext(cwd, getSessionName(cwd));

  logHook("pre-compact", `Compaction triggered (${trigger})`, {
    context_usage_percent: hookInput.context_usage_percent,
    is_first_compaction: isFirstCompaction,
  });

  // Show spinner for auto compaction (context window full)
  const spinner = new Spinner({ style: "neural" });
  if (trigger === "auto") {
    spinner.start("anchoring memory before compaction");
  }

  try {
    const honcho = new Honcho(getHonchoClientOptions(config));
    const sessionName = getSessionName(cwd);

    // Get session and peers using fluent API
    const session = await honcho.session(sessionName);
    const userPeer = await honcho.peer(config.peerName);
    const cursorPeer = await honcho.peer(config.cursorPeer);

    if (trigger === "auto") {
      spinner.update("fetching memory context");
    }

    logApiCall("peer.context", "GET", `${config.peerName} + ${config.cursorPeer}`);
    logApiCall("session.summaries", "GET", sessionName);
    logApiCall("peer.chat", "POST", "dialectic queries x2");

    // Fetch ALL context in parallel - this is the RIGHT time for expensive calls
    // because the context is about to be reset anyway
    const [userContextResult, cursorContextResult, summariesResult, userChatResult, cursorChatResult] =
      await Promise.allSettled([
        // User's full context
        userPeer.context({
          maxConclusions: 30,
          includeMostFrequent: true,
        }),
        // Cursor's self-context
        cursorPeer.context({
          maxConclusions: 20,
          includeMostFrequent: true,
        }),
        // Session summaries
        session.summaries(),
        // Fresh dialectic - ask about user (worth the cost at compaction time)
        userPeer.chat(
          `Summarize the most important things to remember about ${config.peerName}. Focus on their preferences, working style, current projects, and any critical context that should survive a conversation summary.`,
          { session }
        ),
        // Fresh dialectic - cursor self-reflection
        cursorPeer.chat(
          `What are the most important things ${config.cursorPeer} was working on with ${config.peerName}? Summarize key context that should be preserved.`,
          { session }
        ),
      ]);

    // Extract results
    const userContext = userContextResult.status === "fulfilled" ? userContextResult.value : null;
    const cursorContext = cursorContextResult.status === "fulfilled" ? cursorContextResult.value : null;
    const summaries = summariesResult.status === "fulfilled" ? summariesResult.value : null;

    // Build verbose output blocks
    const verboseBlocks: string[] = [];
    verboseBlocks.push(formatVerboseBlock("pre-compact peer.context(user)", (userContext as any)?.representation));
    verboseBlocks.push(formatVerboseBlock("pre-compact peer.context(cursor)", (cursorContext as any)?.representation));
    verboseBlocks.push(formatVerboseList("pre-compact peerCard", (userContext as any)?.peerCard));

    const userDialectic =
      userChatResult.status === "fulfilled"
        ? userChatResult.value
        : null;
    const cursorDialectic =
      cursorChatResult.status === "fulfilled"
        ? cursorChatResult.value
        : null;

    // Format the memory card
    const memoryCard = formatMemoryCard(
      config,
      sessionName,
      userContext,
      cursorContext,
      summaries,
      userDialectic,
      cursorDialectic
    );

    if (trigger === "auto") {
      spinner.stop("memory anchored");
    }

    // Add dialectic responses to verbose output
    if (userDialectic) {
      verboseBlocks.push(formatVerboseBlock(`pre-compact peer.chat(user) -> "${config.peerName}"`, userDialectic));
    }
    if (cursorDialectic) {
      verboseBlocks.push(formatVerboseBlock(`pre-compact peer.chat(cursor) -> "${config.cursorPeer}"`, cursorDialectic));
    }

    logHook("pre-compact", `Memory anchored (${memoryCard.length} chars)`);

    // Output Cursor-format JSON with the memory anchor as user_message
    const output = {
      user_message: `[${config.cursorPeer}/Honcho Memory Anchor]\n\n${memoryCard}`,
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (error) {
    logHook("pre-compact", `Error: ${error}`, { error: String(error) });
    if (trigger === "auto") {
      spinner.fail("memory anchor failed");
    }
    // Don't block compaction on failure
    console.error(`[honcho] Pre-compact warning: ${error}`);
    process.exit(0);
  }
}
