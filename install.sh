#!/usr/bin/env bash
# Install the hivemind skill for Claude Code on Linux / macOS.
# Usage: ./install.sh [--project]   (--project installs into ./.claude/skills of the current repo)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/skills/hivemind"

if [[ "${1:-}" == "--project" ]]; then
  DEST="$PWD/.claude/skills/hivemind"
else
  DEST="$HOME/.claude/skills/hivemind"
fi

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
echo "skill  -> $DEST"

# Turn off AI attribution in commits and PRs.
SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS")"
[[ -f "$SETTINGS" ]] || echo '{}' > "$SETTINGS"
if command -v node >/dev/null 2>&1; then
  node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const s = JSON.parse(fs.readFileSync(p, "utf8"));
    s.attribution = { commit: "", pr: "", sessionUrl: false };
    fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
  ' "$SETTINGS"
  echo "settings -> attribution disabled in $SETTINGS"
else
  echo "node not found; add this to $SETTINGS by hand:"
  echo '  "attribution": { "commit": "", "pr": "", "sessionUrl": false }'
fi

if [[ "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-}" != "1" ]]; then
  echo
  echo "Set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in your shell rc, then restart the terminal."
fi

echo
echo "Done. Run /setup-matt-pocock-skills once per repo, then /hivemind."
