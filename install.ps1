# ──────────────────────────────────────────────────────────────────────
# Honcho Memory for Cursor — Windows Installer (PowerShell)
#
# irm https://raw.githubusercontent.com/plastic-labs/cursor-honcho/main/install.ps1 | iex
#
# What this does:
#   1. Installs bun (if missing)
#   2. Clones cursor-honcho to ~/.honcho/plugins/cursor-honcho
#   3. Installs dependencies
#   4. Creates global ~/.cursor/hooks.json and mcp.json
#   5. Creates ~/.honcho/config.json
#   6. Validates API connection (if HONCHO_API_KEY is set)
# ──────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

$HonchoDir  = Join-Path $env:USERPROFILE ".honcho"
$PluginDir  = Join-Path $HonchoDir "plugins\cursor-honcho"
$PluginRoot = Join-Path $PluginDir "plugins\honcho"
$CursorDir  = Join-Path $env:USERPROFILE ".cursor"
$RepoUrl    = "https://github.com/plastic-labs/cursor-honcho.git"

function Write-Info    { param($msg) Write-Host "  >>> " -ForegroundColor Cyan -NoNewline; Write-Host $msg }
function Write-Ok      { param($msg) Write-Host "  >>> " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warn    { param($msg) Write-Host "  >>> " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Write-Err     { param($msg) Write-Host "  >>> " -ForegroundColor Red -NoNewline; Write-Host $msg }

Write-Host ""
Write-Host "  honcho" -NoNewline -ForegroundColor White
Write-Host " memory for cursor" -ForegroundColor DarkGray
Write-Host "  --------------------" -ForegroundColor DarkGray
Write-Host ""

# ── 1. Prerequisites ─────────────────────────────────────────────────

# Check git
try {
    $null = Get-Command git -ErrorAction Stop
} catch {
    Write-Err "git is required but not installed"
    Write-Host "  Install git: https://git-scm.com"
    exit 1
}

# Check/install bun
try {
    $null = Get-Command bun -ErrorAction Stop
    $bunVersion = & bun --version 2>$null
    Write-Ok "Bun found ($bunVersion)"
} catch {
    Write-Info "Installing bun..."
    try {
        irm bun.sh/install.ps1 | iex
        # Refresh PATH
        $env:BUN_INSTALL = Join-Path $env:USERPROFILE ".bun"
        $env:PATH = "$env:BUN_INSTALL\bin;$env:PATH"
        $bunVersion = & bun --version 2>$null
        Write-Ok "Bun installed ($bunVersion)"
    } catch {
        Write-Err "Failed to install bun"
        Write-Host "  Install manually: https://bun.sh"
        exit 1
    }
}

# ── 2. Clone or update ──────────────────────────────────────────────

if (Test-Path (Join-Path $PluginDir ".git")) {
    Write-Info "Updating existing installation..."
    & git -C $PluginDir pull --quiet 2>$null
    Write-Ok "Updated"
} else {
    Write-Info "Cloning cursor-honcho..."
    $parentDir = Split-Path $PluginDir -Parent
    if (-not (Test-Path $parentDir)) {
        New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }
    & git clone --quiet --depth 1 $RepoUrl $PluginDir
    Write-Ok "Cloned to $PluginDir"
}

# ── 3. Install dependencies ─────────────────────────────────────────

Write-Info "Installing dependencies..."
Push-Location $PluginRoot
try {
    & bun install --silent 2>$null
    Write-Ok "Dependencies installed"
} finally {
    Pop-Location
}

# ── 4. API key check ────────────────────────────────────────────────

$apiKeySet = $false
if ($env:HONCHO_API_KEY) {
    $apiKeySet = $true
    Write-Ok "HONCHO_API_KEY is set"
} else {
    Write-Warn "HONCHO_API_KEY is not set"
    Write-Host ""
    Write-Host "  To get started:" -ForegroundColor White
    Write-Host "  1. Get a free key at " -NoNewline; Write-Host "https://app.honcho.dev" -ForegroundColor White
    Write-Host "  2. Set the environment variable:"
    Write-Host ""
    Write-Host '     [Environment]::SetEnvironmentVariable("HONCHO_API_KEY", "hch-your-key", "User")' -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Or add to your PowerShell profile:" -ForegroundColor DarkGray
    Write-Host '     $env:HONCHO_API_KEY = "hch-your-key"' -ForegroundColor DarkGray
    Write-Host ""
}

# ── 5. Global hooks.json ────────────────────────────────────────────

$HooksFile = Join-Path $CursorDir "hooks.json"
$HooksDir  = Join-Path $PluginRoot "hooks"

# Normalize path separators for JSON (use forward slashes)
$HooksDirJson  = $HooksDir -replace '\\', '/'

$hooksContent = @"
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      { "command": "bun run $HooksDirJson/session-start.ts" }
    ],
    "sessionEnd": [
      { "command": "bun run $HooksDirJson/session-end.ts" }
    ],
    "beforeSubmitPrompt": [
      { "command": "bun run $HooksDirJson/before-submit-prompt.ts" }
    ],
    "postToolUse": [
      {
        "command": "bun run $HooksDirJson/post-tool-use.ts",
        "matcher": "Write|Edit|Shell|Task|MCP"
      }
    ],
    "preCompact": [
      { "command": "bun run $HooksDirJson/pre-compact.ts" }
    ],
    "stop": [
      { "command": "bun run $HooksDirJson/stop.ts" }
    ],
    "subagentStop": [
      { "command": "bun run $HooksDirJson/subagent-stop.ts" }
    ],
    "afterAgentThought": [
      { "command": "bun run $HooksDirJson/after-agent-thought.ts" }
    ],
    "afterAgentResponse": [
      { "command": "bun run $HooksDirJson/after-agent-response.ts" }
    ]
  }
}
"@

if (-not (Test-Path $CursorDir)) {
    New-Item -ItemType Directory -Path $CursorDir -Force | Out-Null
}

if (Test-Path $HooksFile) {
    $existing = Get-Content $HooksFile -Raw
    if ($existing -match "honcho") {
        Write-Info "Hooks already configured"
    } else {
        Write-Warn "Existing hooks.json found at $HooksFile"
        $templatePath = Join-Path $HonchoDir "cursor-hooks.json"
        $hooksContent | Out-File -FilePath $templatePath -Encoding utf8
        Write-Info "Honcho hooks saved to $templatePath"
        Write-Info "Merge manually into $HooksFile"
    }
} else {
    $hooksContent | Out-File -FilePath $HooksFile -Encoding utf8
    Write-Ok "Created $HooksFile"
}

# ── 6. Global mcp.json ──────────────────────────────────────────────

$McpFile   = Join-Path $CursorDir "mcp.json"
$McpServer = Join-Path $PluginRoot "mcp-server.ts"
$McpServerJson = $McpServer -replace '\\', '/'

$mcpContent = @"
{
  "mcpServers": {
    "honcho": {
      "command": "bun",
      "args": ["run", "$McpServerJson"],
      "env": {
        "HONCHO_HOST": "cursor"
      }
    }
  }
}
"@

if (Test-Path $McpFile) {
    $existing = Get-Content $McpFile -Raw
    if ($existing -match "honcho") {
        Write-Info "MCP server already configured"
    } else {
        # Try to merge using PowerShell JSON
        try {
            $mcpObj = $existing | ConvertFrom-Json
            if (-not $mcpObj.mcpServers) {
                $mcpObj | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{}
            }
            $mcpObj.mcpServers | Add-Member -NotePropertyName "honcho" -NotePropertyValue @{
                command = "bun"
                args = @("run", $McpServerJson)
            }
            $mcpObj | ConvertTo-Json -Depth 10 | Out-File -FilePath $McpFile -Encoding utf8
            Write-Ok "Added honcho to existing $McpFile"
        } catch {
            Write-Warn "Existing mcp.json found at $McpFile"
            $templatePath = Join-Path $HonchoDir "cursor-mcp.json"
            $mcpContent | Out-File -FilePath $templatePath -Encoding utf8
            Write-Info "Honcho MCP config saved to $templatePath"
            Write-Info "Merge manually into $McpFile"
        }
    }
} else {
    $mcpContent | Out-File -FilePath $McpFile -Encoding utf8
    Write-Ok "Created $McpFile"
}

# ── 7. Create config and validate ─────────────────────────────────────

$PeerName = if ($env:HONCHO_PEER_NAME) { $env:HONCHO_PEER_NAME } else { $env:USERNAME }
if (-not $PeerName) { $PeerName = "user" }
$ConfigFile = Join-Path $HonchoDir "config.json"

$configContent = @"
{
  "apiKey": "$($env:HONCHO_API_KEY)",
  "peerName": "$PeerName",
  "saveMessages": true,
  "enabled": true,
  "logging": true,
  "hosts": {
    "cursor": {
      "workspace": "cursor",
      "aiPeer": "cursor"
    }
  }
}
"@

if ($apiKeySet) {
    # Validate via SDK
    Write-Info "Validating API key..."
    Push-Location $PluginRoot
    try {
        $result = & bun -e @'
import { Honcho } from "@honcho-ai/sdk";
const h = new Honcho({ apiKey: process.env.HONCHO_API_KEY, baseUrl: "https://api.honcho.dev/v3", workspaceId: "cursor" });
await h.session("install-test");
console.log("ok");
'@ 2>$null
        if ($result -match "ok") {
            Write-Ok "API key is valid"
        } else {
            Write-Warn "API key validation failed -- check your key at https://app.honcho.dev"
        }
    } catch {
        Write-Warn "API key validation failed -- check your key at https://app.honcho.dev"
    } finally {
        Pop-Location
    }

    # Write config
    if (Test-Path $ConfigFile) {
        Write-Info "Config already exists at $ConfigFile"
    } else {
        $configContent | Out-File -FilePath $ConfigFile -Encoding utf8
        Write-Ok "Created $ConfigFile"
    }
}

# ── Done ─────────────────────────────────────────────────────────────

$RulesSrc = Join-Path $PluginRoot "rules\honcho-memory.mdc"

Write-Host ""
Write-Host "  Installation complete" -ForegroundColor Green
Write-Host "  --------------------" -ForegroundColor DarkGray
Write-Host ""

if (-not $apiKeySet) {
    Write-Host "  Next:" -ForegroundColor White
    Write-Host "  1. Set HONCHO_API_KEY (see above)"
    Write-Host "  2. Restart Cursor"
    Write-Host "  3. Run /honcho:status to verify"
} else {
    Write-Host "  Next:" -ForegroundColor White
    Write-Host "  1. Restart Cursor"
    Write-Host "  2. Open a chat -- memory loads automatically"
    Write-Host "  3. Run /honcho:status to verify"
}

Write-Host ""
Write-Host "  To add memory rules to a project:" -ForegroundColor DarkGray
Write-Host "  mkdir -p .cursor/rules; cp $RulesSrc .cursor/rules/" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Docs: https://github.com/plastic-labs/cursor-honcho" -ForegroundColor DarkGray
Write-Host "  Help: https://discord.gg/plasticlabs" -ForegroundColor DarkGray
Write-Host ""
