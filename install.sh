#!/usr/bin/env bash
# Install, update or check the hivemind skill for Claude Code (Linux / macOS / Git Bash).
# All logic lives in install.js; this only finds node. Flags pass through unchanged.
#
#   ./install.sh                     link the skills into ~/.claude/skills (every repo), copy agents
#   ./install.sh --project           also set up the current repo: teams/ with linked skills and
#                                    the lead's autostart + guard hooks (HIVEMIND=0 claude skips them)
#   ./install.sh --project --install --confine   fetch missing skills, hide them from the lead
#   ./install.sh --update            git pull this checkout, reinstall, refresh the current repo
#   ./install.sh --auto-update       let sessions pull this checkout (--no-auto-update: stop)
#   ./install.sh --laya <url|off|setup>  point lesson recall at a local laya classifier, decline it,
#                                    or print its GPU setup steps (runs nothing)
#   ./install.sh --doctor [--fix]    check the setup; --fix applies the safe local fixes
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "node not found; install Node 22.5+ and re-run:" >&2
  echo "  macOS: brew install node   Arch: sudo pacman -S nodejs npm   Windows: winget install OpenJS.NodeJS.LTS" >&2
  echo "  others: https://nodejs.org" >&2
  exit 1
fi
exec node "$HERE/install.js" "$@"
