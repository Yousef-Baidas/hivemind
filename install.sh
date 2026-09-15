#!/usr/bin/env bash
# Install the hivemind skill for Claude Code on Linux / macOS.
#
#   ./install.sh                 skill + agents into ~/.claude (every repo)
#   ./install.sh --project       same into ./.claude of the current repo, plus
#                                ./teams/<profile>/ with skills linked per skills.txt
#   ./install.sh --project --install   also `npx skills add` any skill not on this machine
#   ./install.sh --project --confine   also remove the global ~/.claude/skills/<name>
#                                      symlink for every linked skill, so the lead never sees it
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT=0; LINKFLAGS=()
for a in "$@"; do
  case "$a" in
    --project) PROJECT=1 ;;
    --install|--confine) LINKFLAGS+=("$a") ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done
if (( ${#LINKFLAGS[@]} && !PROJECT )); then echo "${LINKFLAGS[*]} needs --project" >&2; exit 2; fi

if (( PROJECT )); then BASE="$PWD/.claude"; else BASE="$HOME/.claude"; fi

# skill + agents
mkdir -p "$BASE/skills" "$BASE/agents"
for s in hivemind hivemind-review; do
  rm -rf "$BASE/skills/$s"
  cp -R "$HERE/skills/$s" "$BASE/skills/$s"; rm -rf "$BASE/skills/$s/.impeccable"
done
rm -f "$BASE"/agents/hive-*.md
cp "$HERE"/agents/hive-*.md "$BASE/agents/"
echo "skills   -> $BASE/skills/{hivemind,hivemind-review}"
echo "agents   -> $BASE/agents/hive-*.md"

# attribution off
SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS")"
[[ -f "$SETTINGS" ]] || echo '{}' > "$SETTINGS"
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs"); const p = process.argv[1];
    const s = JSON.parse(fs.readFileSync(p, "utf8"));
    s.attribution = { commit: "", pr: "", sessionUrl: false };
    fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
  ' "$SETTINGS"
  echo "settings -> attribution disabled"
else
  echo "node not found; add to $SETTINGS by hand:"
  echo '  "attribution": { "commit": "", "pr": "", "sessionUrl": false }'
fi

# teams (project only)
if (( PROJECT )); then
  mkdir -p teams
  cp -n "$HERE/teams/.gitignore" teams/.gitignore 2>/dev/null || true
  cp "$HERE/teams/link-skills.sh" "$HERE/teams/link-skills.ps1" teams/
  mkdir -p teams/templates
  cp -R "$HERE/templates/." teams/templates/
  for dir in "$HERE"/teams/*/; do
    p="$(basename "$dir")"
    mkdir -p "teams/$p"
    [[ -f "teams/$p/PROFILE.md" ]] || cp "$dir/PROFILE.md" "teams/$p/PROFILE.md"
    [[ -f "teams/$p/skills.txt" ]] || cp "$dir/skills.txt" "teams/$p/skills.txt"
  done
  echo "teams    -> $PWD/teams (PROFILE.md, skills.txt, link-skills.*, templates/)"
  bash teams/link-skills.sh "${LINKFLAGS[@]}"
fi

if [[ "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-}" != "1" ]]; then
  echo
  echo "Set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in your shell rc, then restart the terminal."
fi
echo
echo "Done. /hivemind bootstraps the rest."
