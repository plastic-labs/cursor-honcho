import { Honcho } from "@honcho-ai/sdk";
import { loadConfig, getSessionForPath, getSessionName, getHonchoClientOptions, isPluginEnabled, getCachedStdin } from "../config.js";
import {
  getCachedUserContext,
  isContextCacheStale,
  setCachedUserContext,
  queueMessage,
  incrementMessageCount,
  shouldRefreshKnowledgeGraph,
  markKnowledgeGraphRefreshed,
  getInstanceId,
  chunkContent,
} from "../cache.js";
import { logHook, logApiCall, logCache, setLogContext } from "../log.js";
import { verboseApiResult, verboseList } from "../visual.js";
import { outputPromptContext, outputPromptContinue } from "../output.js";

interface HookInput {
  session_id?: string;
  transcript_path?: string;
  prompt?: string;
  cwd?: string;
  conversation_id?: string;
  generation_id?: string;
  model?: string;
  hook_event_name?: string;
  cursor_version?: string;
  workspace_roots?: string[];
  user_email?: string;
  attachments?: any[];
}

// Patterns to skip heavy context retrieval
const SKIP_CONTEXT_PATTERNS = [
  /^(yes|no|ok|sure|thanks|y|n|yep|nope|yeah|nah|continue|go ahead|do it|proceed)$/i,
  /^\//, // slash commands
];

/**
 * Extract meaningful topics from a prompt for semantic search
 * Instead of crude truncation (prompt.slice(0,500)), extract entities and terms
 */
function extractTopics(prompt: string): string[] {
  const topics: string[] = [];

  // Extract file paths (high signal)
  const filePaths = prompt.match(/[\w\-\/\.]+\.(ts|tsx|js|jsx|py|rs|go|md|json|yaml|yml|toml|sql)/gi) || [];
  topics.push(...filePaths.slice(0, 5));

  // Extract quoted strings (explicit references)
  const quoted = prompt.match(/"([^"]+)"/g)?.map(q => q.slice(1, -1)) || [];
  topics.push(...quoted.slice(0, 3));

  // Extract technical terms (common frameworks/tools)
  const techTerms = prompt.match(/\b(react|vue|svelte|angular|elysia|express|fastapi|django|flask|postgres|redis|docker|kubernetes|bun|node|deno|typescript|python|rust|go|graphql|rest|api|auth|oauth|jwt|stripe|webhook)\b/gi) || [];
  topics.push(...[...new Set(techTerms.map(t => t.toLowerCase()))].slice(0, 5));

  // Extract error patterns (debugging context)
  const errors = prompt.match(/error[:\s]+[\w\s]+|failed[:\s]+[\w\s]+|exception[:\s]+[\w\s]+/gi) || [];
  topics.push(...errors.slice(0, 2));

  // If we found meaningful topics, use them; otherwise fall back to first 200 chars
  if (topics.length > 0) {
    return [...new Set(topics)];
  }

  // Fallback: extract meaningful words (>3 chars, not common words)
  const commonWords = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are', 'was', 'were', 'been', 'being', 'has', 'had', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might', 'must', 'shall', 'need', 'want', 'like', 'just', 'also', 'more', 'some', 'what', 'when', 'where', 'which', 'who', 'how', 'why', 'all', 'each', 'every', 'both', 'few', 'most', 'other', 'into', 'over', 'such', 'only', 'same', 'than', 'very', 'your', 'make', 'take', 'come', 'give', 'look', 'think', 'know', 'see', 'time', 'year', 'people', 'way', 'day', 'work']);
  const words = prompt.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
  const meaningfulWords = words.filter(w => !commonWords.has(w));
  return [...new Set(meaningfulWords)].slice(0, 10);
}

function shouldSkipContextRetrieval(prompt: string): boolean {
  return SKIP_CONTEXT_PATTERNS.some((p) => p.test(prompt.trim()));
}


export async function handleBeforeSubmitPrompt(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    process.exit(0);
  }

  // Early exit if plugin is disabled
  if (!isPluginEnabled()) {
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

  const prompt = hookInput.prompt || "";
  const cwd = hookInput.workspace_roots?.[0] || hookInput.cwd || process.env.CURSOR_PROJECT_DIR || process.cwd();

  // Set log context for this hook
  setLogContext(cwd, getSessionName(cwd));

  // Skip empty prompts
  if (!prompt.trim()) {
    process.exit(0);
  }

  logHook("before-submit-prompt", `Prompt received (${prompt.length} chars)`);

  // CRITICAL: Save message to local queue FIRST (instant, ~1-3ms)
  // This survives ctrl+c, network failures, everything
  if (config.saveMessages !== false) {
    queueMessage(prompt, config.peerName, cwd);
  }

  // Start upload immediately (we'll await before exit)
  let uploadPromise: Promise<void> | null = null;
  if (config.saveMessages !== false) {
    uploadPromise = uploadMessageAsync(config, cwd, prompt, hookInput);
  }

  // Track message count for threshold-based knowledge graph refresh
  const messageCount = incrementMessageCount();

  // For trivial prompts, skip heavy context retrieval but still upload
  if (shouldSkipContextRetrieval(prompt)) {
    logHook("before-submit-prompt", "Skipping context (trivial prompt)");
    if (uploadPromise) await uploadPromise.catch((e) => logHook("before-submit-prompt", `Upload failed: ${e}`, { error: String(e) }));
    // Output continue with no extra context
    outputPromptContinue();
    process.exit(0);
  }

  // Determine if we should refresh: either cache is stale OR message threshold reached
  const forceRefresh = shouldRefreshKnowledgeGraph();
  const cachedContext = getCachedUserContext();
  const cacheIsStale = isContextCacheStale();

  if (cachedContext && !cacheIsStale && !forceRefresh) {
    // Use cached context - instant response
    logCache("hit", "userContext", "using cached");

    // Verbose output (file-based)
    const cachedRep = cachedContext?.representation;
    verboseApiResult("session.context() -> representation (cached)", cachedRep);
    verboseList("session.context() -> peerCard (cached)", cachedContext?.peerCard);

    const contextParts = formatCachedContext(cachedContext, config.peerName);
    if (contextParts.length > 0) {
      outputPromptContext({
        peerName: config.peerName,
        aiPeer: config.aiPeer,
        contextParts,
        systemMsg: `[honcho] user-prompt \u2190 context injected (cached)`,
      });
    } else {
      outputPromptContinue("[honcho] user-prompt \u2022 no cached context available");
    }
    if (uploadPromise) await uploadPromise.catch((e) => logHook("before-submit-prompt", `Upload failed: ${e}`, { error: String(e) }));
    process.exit(0);
  }

  // Fetch fresh context when:
  // 1. Cache is stale (>60s old), OR
  // 2. Message threshold reached (every N messages)
  logCache("miss", "userContext", forceRefresh ? "threshold refresh" : "stale cache");
  try {
    const { parts: contextParts, conclusionCount } = await fetchFreshContext(config, cwd, prompt);
    if (contextParts.length > 0) {
      outputPromptContext({
        peerName: config.peerName,
        aiPeer: config.aiPeer,
        contextParts,
        systemMsg: `[honcho] user-prompt \u2190 fresh context injected`,
      });
    } else {
      outputPromptContinue("[honcho] user-prompt \u2022 no matching context found");
    }
    // Mark that we refreshed the knowledge graph
    if (forceRefresh) {
      markKnowledgeGraphRefreshed();
    }
  } catch {
    // Don't block prompt submission on failure
    outputPromptContinue("[honcho] user-prompt \u2717 context fetch failed");
  }

  // Ensure upload completes before exit
  if (uploadPromise) await uploadPromise.catch((e) => logHook("before-submit-prompt", `Upload failed: ${e}`, { error: String(e) }));
  process.exit(0);
}

async function uploadMessageAsync(config: any, cwd: string, prompt: string, hookInput?: any): Promise<void> {
  logApiCall("session.addMessages", "POST", `user prompt (${prompt.length} chars)`);
  const honcho = new Honcho(getHonchoClientOptions(config));
  const sessionName = getSessionName(cwd);

  // Get session and peer using fluent API
  const session = await honcho.session(sessionName);
  const userPeer = await honcho.peer(config.peerName);

  // Chunk large messages to stay under API size limits
  const instanceId = getInstanceId();
  const chunks = chunkContent(prompt);
  const messages = chunks.map(chunk =>
    userPeer.message(chunk, {
      metadata: {
        instance_id: instanceId || undefined,
        session_affinity: sessionName,
        model: hookInput?.model || undefined,
        cursor_version: hookInput?.cursor_version || undefined,
        user_email: hookInput?.user_email || undefined,
        generation_id: hookInput?.generation_id || undefined,
      }
    })
  );
  await session.addMessages(messages);
}

function formatCachedContext(context: any, peerName: string): string[] {
  const parts: string[] = [];
  const rep = context?.representation;

  if (typeof rep === "string" && rep.trim()) {
    const lines = rep.split("\n").filter((l: string) => l.trim() && !l.startsWith("#"));
    const summary = lines.slice(0, 5).map((l: string) => l.replace(/^\[.*?\]\s*/, "").replace(/^- /, "")).join("; ");
    if (summary) parts.push(`Relevant conclusions: ${summary}`);
  }

  const peerCard = context?.peerCard;
  if (peerCard?.length) {
    parts.push(`Profile: ${peerCard.join("; ")}`);
  }

  return parts;
}

interface FreshContextResult {
  parts: string[];
  conclusionCount: number;
}

async function fetchFreshContext(config: any, cwd: string, prompt: string): Promise<FreshContextResult> {
  const honcho = new Honcho(getHonchoClientOptions(config));
  const sessionName = getSessionName(cwd);

  // Get session using fluent API
  const session = await honcho.session(sessionName);

  const contextParts: string[] = [];
  let conclusionCount = 0;

  // Only use context() here - it's free and returns pre-computed knowledge
  // Skip chat() - only use at session-start
  const startTime = Date.now();

  // Extract meaningful topics instead of crude truncation
  const topics = extractTopics(prompt);
  const searchQuery = topics.length > 0 ? topics.join(' ') : prompt.slice(0, 200);

  const contextResult = await session.context({
    searchQuery,
    representationOptions: {
      searchTopK: 10,
      searchMaxDistance: 0.7,
      maxConclusions: 15,
    },
  });

  logApiCall("session.context", "GET", `search query`, Date.now() - startTime, true);

  if (contextResult) {
    setCachedUserContext(contextResult); // Update cache
    const rep = (contextResult as any).representation;

    // Verbose output (file-based)
    verboseApiResult("session.context() -> representation", rep);
    verboseList("session.context() -> peerCard", (contextResult as any).peerCard);

    if (typeof rep === "string" && rep.trim()) {
      const lines = rep.split("\n").filter((l: string) => l.trim() && !l.startsWith("#"));
      conclusionCount = lines.length;
      const summary = lines.slice(0, 5).map((l: string) => l.replace(/^\[.*?\]\s*/, "").replace(/^- /, "")).join("; ");
      if (summary) contextParts.push(`Relevant conclusions: ${summary}`);
      logCache("write", "userContext", `${conclusionCount} conclusions`);
    }

    const peerCard = (contextResult as any).peerCard;
    if (peerCard?.length) {
      contextParts.push(`Profile: ${peerCard.join("; ")}`);
    }
  }

  return { parts: contextParts, conclusionCount };
}

