#!/usr/bin/env bun
import { detectHost, setDetectedHost, cacheStdin } from "../src/config.js";
import { handleSubagentStop } from "../src/hooks/subagent-stop.js";

const stdinText = await Bun.stdin.text();
cacheStdin(stdinText);
let input = {};
try { input = JSON.parse(stdinText || "{}"); } catch { /* malformed stdin */ }
setDetectedHost(detectHost(input));
await handleSubagentStop();
