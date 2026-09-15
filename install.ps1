# Install the hivemind skill for Claude Code on Windows.
#
#   .\install.ps1                  skill + agents into ~\.claude (every repo)
#   .\install.ps1 -Project         same into .\.claude of the current repo, plus
#                                  .\teams\<profile>\ with skills linked per skills.txt
#   .\install.ps1 -Project -Confine
#                                  also remove the global ~\.claude\skills\<name>
#                                  link for every skill linked into a profile
param([switch]$Project, [switch]$Confine)

$ErrorActionPreference = "Stop"
if ($Confine -and -not $Project) { throw "-Confine needs -Project" }
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

# teams (project only). Uses junctions, which need no admin rights.
if ($Project) {
    New-Item -ItemType Directory -Force -Path "teams" | Out-Null
    if (-not (Test-Path "teams\.gitignore")) { Copy-Item (Join-Path $Here "teams\.gitignore") "teams\.gitignore" }
    $missing = @()
    foreach ($dir in Get-ChildItem (Join-Path $Here "teams") -Directory) {
        $p = $dir.Name
        $skillsDir = "teams\$p\.claude\skills"
        New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null
        if (-not (Test-Path "teams\$p\PROFILE.md")) { Copy-Item (Join-Path $dir.FullName "PROFILE.md") "teams\$p\PROFILE.md" }
        if (-not (Test-Path "teams\$p\skills.txt")) { Copy-Item (Join-Path $dir.FullName "skills.txt") "teams\$p\skills.txt" }
        $n = 0
        foreach ($line in Get-Content "teams\$p\skills.txt") {
            $name = $line.Trim()
            if ($name -eq "" -or $name.StartsWith("#")) { continue }
            $src = $null
            foreach ($cand in @((Join-Path $HOME ".agents\skills\$name"), (Join-Path $HOME ".claude\skills\$name"))) {
                if (Test-Path $cand -PathType Container) { $src = (Get-Item $cand).ResolvedTarget; if (-not $src) { $src = $cand }; break }
            }
            if (-not $src) { $missing += "${p}:$name"; continue }
            $link = Join-Path $skillsDir $name
            if (Test-Path $link) { Remove-Item -Force $link }
            New-Item -ItemType Junction -Path $link -Target $src | Out-Null
            $n++
            if ($Confine) {
                $g = Join-Path $HOME ".claude\skills\$name"
                if ((Test-Path $g) -and (Get-Item $g).LinkType) { Remove-Item -Force $g }
            }
        }
        Write-Host "teams/$p -> $n skills linked"
    }
    if ($missing.Count) {
        Write-Host ""
        Write-Host "not installed on this machine (find them on https://skills.sh, then: npx skills add <owner/repo>):"
        $missing | ForEach-Object { Write-Host "  $_" }
    }
    if ($Confine) { Write-Host "confined: linked skills removed from ~\.claude\skills (restart Claude Code)" }
}

if ($env:CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS -ne "1") {
    Write-Host ""
    Write-Host 'Run once, then restart the terminal:'
    Write-Host '  [Environment]::SetEnvironmentVariable("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "1", "User")'
}
Write-Host ""
Write-Host "Done. /hivemind bootstraps the rest."
