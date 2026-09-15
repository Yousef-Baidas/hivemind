# Install the hivemind skill for Claude Code on Windows.
# Usage: .\install.ps1 [-Project]   (-Project installs into .\.claude\skills of the current repo)
param([switch]$Project)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Src  = Join-Path $Here "skills\hivemind"

if ($Project) {
    $Dest = Join-Path (Get-Location) ".claude\skills\hivemind"
} else {
    $Dest = Join-Path $HOME ".claude\skills\hivemind"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Dest) | Out-Null
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
Copy-Item -Recurse $Src $Dest
Write-Host "skill  -> $Dest"

# Turn off AI attribution in commits and PRs.
$Settings = Join-Path $HOME ".claude\settings.json"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Settings) | Out-Null
if (-not (Test-Path $Settings)) { Set-Content -Path $Settings -Value "{}" }

if (Get-Command node -ErrorAction SilentlyContinue) {
    $js = @'
const fs = require("fs");
const p = process.argv[1];
const s = JSON.parse(fs.readFileSync(p, "utf8"));
s.attribution = { commit: "", pr: "", sessionUrl: false };
fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
'@
    node -e $js $Settings
    Write-Host "settings -> attribution disabled in $Settings"
} else {
    Write-Host "node not found; add this to $Settings by hand:"
    Write-Host '  "attribution": { "commit": "", "pr": "", "sessionUrl": false }'
}

if ($env:CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS -ne "1") {
    Write-Host ""
    Write-Host 'Run once, then restart the terminal:'
    Write-Host '  [Environment]::SetEnvironmentVariable("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1", "User")'
}

Write-Host ""
Write-Host "Done. Run /setup-matt-pocock-skills once per repo, then /hivemind."
