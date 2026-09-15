# Link each profile's skills into teams\<profile>\.claude\skills\ (junctions, no admin needed).
# Run from the repo root. Copied here by hivemind's install.ps1 -Project;
# hive-scout re-runs it after rewriting a skills.txt.
#
#   .\teams\link-skills.ps1            link what is already on this machine
#   .\teams\link-skills.ps1 -Install   also `npx skills add` anything missing
#   .\teams\link-skills.ps1 -Confine   also drop ~\.claude\skills\<name> links
#
# skills.txt line format:  <owner/repo> <skill-name>
param([switch]$Install, [switch]$Confine)
$ErrorActionPreference = "Stop"
if (-not (Test-Path "teams" -PathType Container)) { throw "no teams\ here; run from the repo root" }

function Find-Src([string]$name) {
    foreach ($cand in @((Join-Path $HOME ".agents\skills\$name"), (Join-Path $HOME ".claude\skills\$name"))) {
        if (Test-Path $cand -PathType Container) {
            $item = Get-Item $cand
            if ($item.LinkType -and $item.Target) { return [string]$item.Target[0] }
            return $cand
        }
    }
    return $null
}

$missing = @()
foreach ($dir in Get-ChildItem "teams" -Directory) {
    $p = $dir.Name
    $list = Join-Path $dir.FullName "skills.txt"
    if (-not (Test-Path $list)) { continue }
    $skillsDir = Join-Path $dir.FullName ".claude\skills"
    New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null
    $n = 0
    foreach ($line in Get-Content $list) {
        $parts = $line.Trim() -split '\s+'
        if ($parts.Count -eq 0 -or $parts[0] -eq "" -or $parts[0].StartsWith("#")) { continue }
        if ($parts.Count -lt 2) { Write-Warning "teams/$p/skills.txt: line needs '<owner/repo> <skill>': $line"; continue }
        $source = $parts[0]; $name = $parts[1]
        $src = Find-Src $name
        if (-not $src -and $Install) {
            & npx -y skills add $source --skill $name -g -y -a claude-code *> $null
            $src = Find-Src $name
        }
        if (-not $src) { $missing += "${p}: npx skills add $source --skill $name -g -y"; continue }
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
    Write-Host "missing; install then re-run (or pass -Install):"
    $missing | ForEach-Object { Write-Host "  $_" }
}
if ($Confine) { Write-Host "confined: linked skills removed from ~\.claude\skills (restart Claude Code)" }
