# Install, update or check the hivemind skill for Claude Code on Windows.
# All logic lives in install.js; this only finds node and maps the switches.
# Windows blocks unsigned scripts by default, so run it as:
#
#   powershell -ExecutionPolicy Bypass -File install.ps1                     skills + agents for every repo
#   powershell -ExecutionPolicy Bypass -File C:\path\to\hivemind\install.ps1 -Project
#                                  also set up the current repo: teams\ with linked skills and
#                                  the lead's autostart + guard hooks
#   ... -Project -Install -Confine fetch missing skills, hide them from the lead
#   ... -Update                    git pull this checkout, reinstall, refresh the current repo
#   ... -AutoUpdate                let sessions pull this checkout (-NoAutoUpdate: stop)
#   ... -Doctor [-Fix]             check the setup; -Fix applies the safe local fixes
#
# Or skip PowerShell entirely: node C:\path\to\hivemind\install.js --project
param([switch]$Project, [switch]$Install, [switch]$Confine, [switch]$Update,
      [switch]$Doctor, [switch]$Fix, [switch]$AutoUpdate, [switch]$NoAutoUpdate)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "node not found; install Node 22.5+, open a new terminal, and re-run:"
    Write-Host "  winget install OpenJS.NodeJS.LTS"
    exit 1
}
$flags = @()
if ($Project)      { $flags += "--project" }
if ($Install)      { $flags += "--install" }
if ($Confine)      { $flags += "--confine" }
if ($Update)       { $flags += "--update" }
if ($Doctor)       { $flags += "--doctor" }
if ($Fix)          { $flags += "--fix" }
if ($AutoUpdate)   { $flags += "--auto-update" }
if ($NoAutoUpdate) { $flags += "--no-auto-update" }
& node (Join-Path $PSScriptRoot "install.js") @flags
exit $LASTEXITCODE
