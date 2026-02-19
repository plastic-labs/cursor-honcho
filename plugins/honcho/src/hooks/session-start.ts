import { Honcho } from "@honcho-ai/sdk";
import { loadConfig, getSessionForPath, setSessionForPath, getSessionName, getHonchoClientOptions, isPluginEnabled } from "../config.js";
import {
  setCachedUserContext,
  setCachedClaudeContext,
  loadClaudeLocalContext,
  resetMessageCount,
  setClaudeInstanceId,
  getCachedGitState,
  setCachedGitState,
  detectGitChanges,
} from "../cache.js";
import { Spinner } from "../spinner.js";
import { displayHonchoStartup } from "../pixel.js";
import { captureGitState, getRecentCommits, isGitRepo, inferFeatureContext } from "../git.js";
import { logHook, logApiCall, logCache, logFlow, logAsync, setLogContext } from "../log.js";
import { verboseApiResult, verboseList, clearVerboseLog } from "../visual.js";

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
  is_background_agent?: boolean;
  composer_mode?: string;
}

function formatRepresentation(rep: any): string {
  if (typeof rep === "string" && rep.trim()) {
    return rep;
  }
  return "";
}

export async function handleSessionStart(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    const setupMessage = `## Honcho Memory -- Setup Required

Honcho is installed but not yet configured. To enable persistent memory:

1. Get a free API key at https://app.honcho.dev
2. Add it to your shell config (~/.zshrc or ~/.bashrc):
   \`\`\`
   export HONCHO_API_KEY="your-key-here"
   \`\`\`
3. Restart Cursor to pick up the new environment variable

Or run \`/honcho:setup\` for guided configuration.`;

    const output = {
      additional_context: setupMessage,
      user_message: "[honcho] Not configured -- run /honcho:setup or set HONCHO_API_KEY",
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  }

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
    // No input or invalid JSON
  }

  const cwd = hookInput.workspace_roots?.[0] || process.env.CURSOR_PROJECT_DIR || process.cwd();
  const cursorInstanceId = hookInput.conversation_id || hookInput.session_id;
  const isBackground = hookInput.is_background_agent || false;

  if (cursorInstanceId) {
    setClaudeInstanceId(cursorInstanceId);
  }

  const sessionName = getSessionName(cwd);
  setLogContext(cwd, sessionName);
  clearVerboseLog();
  resetMessageCount();

  // Capture git state
  const previousGitState = getCachedGitState(cwd);
  const currentGitState = captureGitState(cwd);
  const gitChanges = currentGitState ? detectGitChanges(previousGitState, currentGitState) : [];
  const recentCommits = isGitRepo(cwd) ? getRecentCommits(cwd, 5) : [];
  const featureContext = currentGitState ? inferFeatureContext(currentGitState, recentCommits) : null;

  if (currentGitState) {
    setCachedGitState(cwd, currentGitState);
  }

  // Start loading animation (skip for background agents)
  const spinner = new Spinner({ style: "neural" });
  if (!isBackground) {
    spinner.start("loading memory");
  }

  try {
    logHook("session-start", `Starting session in ${cwd}`, { branch: currentGitState?.branch });
    logFlow("init", `workspace: ${config.workspace}, peers: ${config.peerName}/${config.cursorPeer}`);

    const honcho = new Honcho(getHonchoClientOptions(config));

    if (!isBackground) spinner.update("Loading session");

    const [session, userPeer, cursorPeerObj] = await Promise.all([
      honcho.session(sessionName),
      honcho.peer(config.peerName),
      honcho.peer(config.cursorPeer),
    ]);
    logApiCall("honcho.session/peer", "GET", `session + 2 peers`, Date.now(), true);

    // Set peer observation config (fire-and-forget)
    Promise.all([
      session.setPeerConfiguration(userPeer, { observeMe: true, observeOthers: false }),
      session.setPeerConfiguration(cursorPeerObj, { observeMe: false, observeOthers: true }),
    ]).catch((e) => logHook("session-start", `Set peers failed: ${e}`));

    if (!getSessionForPath(cwd)) {
      setSessionForPath(cwd, sessionName);
    }

    // Upload git changes
    if (gitChanges.length > 0) {
      const gitObservations = gitChanges
        .filter((c) => c.type !== "initial")
        .map((change) =>
          userPeer.message(`[Git External] ${change.description}`, {
            metadata: {
              type: "git_change",
              change_type: change.type,
              from: change.from,
              to: change.to,
              external: true,
            },
          })
        );
      if (gitObservations.length > 0) {
        session.addMessages(gitObservations).catch((e) =>
          logHook("session-start", `Git observations upload failed: ${e}`)
        );
      }
    }

    // Parallel context fetch
    if (!isBackground) spinner.update("Fetching memory context");
    logAsync("context-fetch", "Starting 5 parallel context fetches");
    const contextParts: string[] = [];

    let headerContent = `## Honcho Memory System Active
- User: ${config.peerName}
- AI: ${config.cursorPeer}
- Workspace: ${config.workspace}
- Session: ${sessionName}
- Directory: ${cwd}`;

    if (currentGitState) {
      headerContent += `\n- Git Branch: ${currentGitState.branch}`;
      headerContent += `\n- Git HEAD: ${currentGitState.commit}`;
      if (currentGitState.isDirty) {
        headerContent += `\n- Working Tree: ${currentGitState.dirtyFiles.length} uncommitted changes`;
      }
    }

    if (featureContext && featureContext.confidence !== "low") {
      headerContent += `\n- Feature: ${featureContext.type} - ${featureContext.description}`;
      if (featureContext.areas.length > 0) {
        headerContent += `\n- Areas: ${featureContext.areas.join(", ")}`;
      }
    }

    contextParts.push(headerContent);

    if (featureContext) {
      const featureSection = [
        `## Inferred Feature Context`,
        `- Type: ${featureContext.type}`,
        `- Description: ${featureContext.description}`,
      ];
      if (featureContext.keywords.length > 0) {
        featureSection.push(`- Keywords: ${featureContext.keywords.join(", ")}`);
      }
      if (featureContext.areas.length > 0) {
        featureSection.push(`- Code Areas: ${featureContext.areas.join(", ")}`);
      }
      featureSection.push(`- Confidence: ${featureContext.confidence}`);
      contextParts.push(featureSection.join("\n"));
    }

    if (gitChanges.length > 0) {
      const changeDescriptions = gitChanges.map((c) => `- ${c.description}`).join("\n");
      contextParts.push(`## Git Activity Since Last Session\n${changeDescriptions}`);
    }

    const localCursorContext = loadClaudeLocalContext();
    if (localCursorContext) {
      contextParts.push(`## Cursor Local Context (What I Was Working On)\n${localCursorContext.slice(0, 2000)}`);
    }

    // Context-aware dialectic queries
    const branchContext = currentGitState ? ` They are currently on git branch '${currentGitState.branch}'.` : "";
    const changeContext = gitChanges.length > 0 && gitChanges[0].type === "branch_switch"
      ? ` Note: they just switched branches from '${gitChanges[0].from}' to '${gitChanges[0].to}'.`
      : "";
    const featureHint = featureContext && featureContext.confidence !== "low"
      ? ` Current work appears to be: ${featureContext.type} - ${featureContext.description}.`
      : "";

    const fetchStart = Date.now();
    const [userContextResult, cursorContextResult, summariesResult, userChatResult, cursorChatResult] =
      await Promise.allSettled([
        userPeer.context({ maxConclusions: 25, includeMostFrequent: true }),
        cursorPeerObj.context({ maxConclusions: 15, includeMostFrequent: true }),
        session.summaries(),
        userPeer.chat(
          `Summarize what you know about ${config.peerName} in 2-3 sentences. Focus on their preferences, current projects, and working style.${branchContext}${changeContext}${featureHint}`,
          { session }
        ),
        cursorPeerObj.chat(
          `What has ${config.cursorPeer} been working on recently?${branchContext}${featureHint} Summarize the AI assistant's recent activities and focus areas relevant to the current work context.`,
          { session }
        ),
      ]);

    const fetchDuration = Date.now() - fetchStart;
    const asyncResults = [
      { name: "peer.context(user)", success: userContextResult.status === "fulfilled" },
      { name: "peer.context(cursor)", success: cursorContextResult.status === "fulfilled" },
      { name: "session.summaries", success: summariesResult.status === "fulfilled" },
      { name: "peer.chat(user)", success: userChatResult.status === "fulfilled" },
      { name: "peer.chat(cursor)", success: cursorChatResult.status === "fulfilled" },
    ];
    const successCount = asyncResults.filter(r => r.success).length;
    logAsync("context-fetch", `Completed: ${successCount}/5 succeeded in ${fetchDuration}ms`, asyncResults);

    // Verbose logging
    if (userContextResult.status === "fulfilled" && userContextResult.value) {
      const ctx = userContextResult.value as any;
      verboseApiResult("peer.context(user) -> representation", ctx.representation);
      verboseList("peer.context(user) -> peerCard", ctx.peerCard);
    }
    if (cursorContextResult.status === "fulfilled" && cursorContextResult.value) {
      const ctx = cursorContextResult.value as any;
      verboseApiResult("peer.context(cursor) -> representation", ctx.representation);
    }
    if (summariesResult.status === "fulfilled" && summariesResult.value) {
      const s = summariesResult.value as any;
      verboseApiResult("session.summaries() -> shortSummary", s.shortSummary?.content);
    }
    if (userChatResult.status === "fulfilled") {
      const chatVal = typeof userChatResult.value === "string" ? userChatResult.value : (userChatResult.value as any)?.content;
      verboseApiResult(`peer.chat(user) -> "${config.peerName}"`, chatVal);
    }
    if (cursorChatResult.status === "fulfilled") {
      const chatVal = typeof cursorChatResult.value === "string" ? cursorChatResult.value : (cursorChatResult.value as any)?.content;
      verboseApiResult(`peer.chat(cursor) -> "${config.cursorPeer}"`, chatVal);
    }

    // Build context sections
    if (userContextResult.status === "fulfilled" && userContextResult.value) {
      const context = userContextResult.value as any;
      setCachedUserContext(context);
      const rep = context.representation;
      const userSection: string[] = [];
      const peerCard = context.peerCard;
      if (peerCard && peerCard.length > 0) {
        userSection.push(peerCard.join("\n"));
      }
      if (rep) {
        const repText = formatRepresentation(rep);
        if (repText) userSection.push(repText);
      }
      if (userSection.length > 0) {
        contextParts.push(`## ${config.peerName}'s Profile\n${userSection.join("\n\n")}`);
      }
    }

    if (cursorContextResult.status === "fulfilled" && cursorContextResult.value) {
      const context = cursorContextResult.value as any;
      setCachedClaudeContext(context);
      const rep = context.representation;
      if (rep) {
        const repText = formatRepresentation(rep);
        if (repText) {
          contextParts.push(`## ${config.cursorPeer}'s Work History (Self-Context)\n${repText}`);
        }
      }
    }

    if (summariesResult.status === "fulfilled" && summariesResult.value) {
      const s = summariesResult.value as any;
      const shortSummary = s.shortSummary;
      if (shortSummary?.content) {
        contextParts.push(`## Recent Session Summary\n${shortSummary.content}`);
      }
    }

    const userChatContent = userChatResult.status === "fulfilled"
      ? (typeof userChatResult.value === "string" ? userChatResult.value : (userChatResult.value as any)?.content)
      : null;
    if (userChatContent) {
      contextParts.push(`## AI Summary of ${config.peerName}\n${userChatContent}`);
    }

    const cursorChatContent = cursorChatResult.status === "fulfilled"
      ? (typeof cursorChatResult.value === "string" ? cursorChatResult.value : (cursorChatResult.value as any)?.content)
      : null;
    if (cursorChatContent) {
      contextParts.push(`## AI Self-Reflection (What ${config.cursorPeer} Has Been Doing)\n${cursorChatContent}`);
    }

    if (!isBackground) spinner.stop();

    logFlow("complete", `Memory loaded: ${contextParts.length} sections, ${successCount}/5 API calls succeeded`);

    // Display pixel art to TTY
    if (!isBackground) {
      const { displayHonchoStartupTTY } = await import("../pixel.js");
      displayHonchoStartupTTY("Honcho Memory", "persistent context");
    }

    // Output Cursor-format JSON
    const memoryContext = `[${config.cursorPeer}/Honcho Memory Loaded]\n\n${contextParts.join("\n\n")}`;
    const output = {
      additional_context: memoryContext,
      user_message: `[honcho] Memory loaded: ${contextParts.length} sections, ${successCount}/5 sources`,
    };
    console.log(JSON.stringify(output));
    process.exit(0);
  } catch (error) {
    logHook("session-start", `Error: ${error}`, { error: String(error) });
    if (!isBackground) spinner.fail("memory load failed");
    console.error(`[honcho] ${error}`);
    process.exit(1);
  }
}
