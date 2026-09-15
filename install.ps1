# Install the hivemind skill for Claude Code on Windows.
#
#   .\install.ps1                  skill + agents into ~\.claude (every repo)
#   .\install.ps1 -Project         same into .\.claude of the current repo, plus
#                                  .\teams\<profile>\ with skills linked per skills.txt
#   .\install.ps1 -Project -Install  also `npx skills add` any skill not on this machine
#   .\install.ps1 -Project -Confine  also remove the global ~\.claude\skills\<name>
#                                    link for every linked skill, so the lead never sees it
param([switch]$Project, [switch]$Install, [switch]$Confine)

$ErrorActionPreference = "Stop"
if (($Install -or $Confine) -and -not $Project) { throw "-Install/-Confine need -Project" }
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Base = if ($Project) { Join-Path (Get-Location) ".claude" } else { Join-Path $HOME ".claude" }

# skill + agents
New-Item -ItemType Directory -Force -Path (Join-Path $Base "skills"), (Join-Path $Base "agents") | Out-Null
$Dest = Join-Path $Base "skills\hivemind"
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
Copy-Item -Recurse (Join-Path $Here "skills\hivemind") $Dest
Get-ChildItem (Join-Path $Base "agents") -Filter "hive-*.md" -ErrorAction SilentlyContinue | Remove-Item -Force
Copy-Item (Join-Path $Here "agents\hive-*.md") (Join-Path $Base "agents")
Write-Host "skill    -> $Dest"
Write-Host "agents   -> $Base\agents\hive-*.md"

# attribution off
$Settings = Join-Path $HOME ".claude\settings.json"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Settings) | Out-Null
if (-not (Test-Path $Settings)) { Set-Content -Path $Settings -Value "{}" }
if (Get-Command node -ErrorAction SilentlyContinue) {
    $js = @'
const fs = require("fs"); const p = process.argv[1];
const s = JSON.parse(fs.readFileSync(p, "utf8"));
s.attribution = { commit: "", pr: "", sessionUrl: false };
fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
'@
    node -e $js $Settings
    Write-Host "settings -> attribution disabled"
} else {
    Write-Host "node not found; add to $Settings by hand:"
    Write-Host '  "attribution": { "commit": "", "pr": "", "sessionUrl": false }'
}

# teams (project only)
if ($Project) {
    New-Item -ItemType Directory -Force -Path "teams" | Out-Null
    if (-not (Test-Path "teams\.gitignore")) { Copy-Item (Join-Path $Here "teams\.gitignore") "teams\.gitignore" }
    Copy-Item (Join-Path $Here "teams\link-skills.sh"), (Join-Path $Here "teams\link-skills.ps1") "teams\"
    foreach ($dir in Get-ChildItem (Join-Path $Here "teams") -Directory) {
        $p = $dir.Name
        New-Item -ItemType Directory -Force -Path "teams\$p" | Out-Null
        if (-not (Test-Path "teams\$p\PROFILE.md")) { Copy-Item (Join-Path $dir.FullName "PROFILE.md") "teams\$p\PROFILE.md" }
        if (-not (Test-Path "teams\$p\skills.txt")) { Copy-Item (Join-Path $dir.FullName "skills.txt") "teams\$p\skills.txt" }
    }
    Write-Host "teams    -> $(Get-Location)\teams (PROFILE.md, skills.txt, link-skills.*)"
    & ".\teams\link-skills.ps1" -Install:$Install -Confine:$Confine
}

if ($env:CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS -ne "1") {
    Write-Host ""
    Write-Host 'Run once, then restart the terminal:'
    Write-Host '  [Environment]::SetEnvironmentVariable("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1", "User")'
}
Write-Host ""
Write-Host "Done. /hivemind bootstraps the rest."
