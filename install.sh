#!/usr/bin/env bash
# Install the hivemind skill for Claude Code on Linux / macOS.
#
#   ./install.sh                 skill + agents into ~/.claude (every repo)
#   ./install.sh --project       same into ./.claude of the current repo, plus
#                                ./teams/<profile>/ with skills linked per skills.txt
#   ./install.sh --project --confine
#                                also remove the global ~/.claude/skills/<name>
#                                symlink for every skill linked into a profile,
#                                so the lead never sees it
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT=0; CONFINE=0
for a in "$@"; do
  case "$a" in
    --project) PROJECT=1 ;;
    --confine) CONFINE=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done
if (( CONFINE && !PROJECT )); then echo "--confine needs --project" >&2; exit 2; fi

if (( PROJECT )); then BASE="$PWD/.claude"; else BASE="$HOME/.claude"; fi

# skill + agents
mkdir -p "$BASE/skills" "$BASE/agents"
rm -rf "$BASE/skills/hivemind"
cp -R "$HERE/skills/hivemind" "$BASE/skills/hivemind"
rm -f "$BASE"/agents/hive-*.md
cp "$HERE"/agents/hive-*.md "$BASE/agents/"
echo "skill    -> $BASE/skills/hivemind"
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
  missing=()
  for dir in "$HERE"/teams/*/; do
    p="$(basename "$dir")"
    mkdir -p "teams/$p/.claude/skills"
    [[ -f "teams/$p/PROFILE.md" ]] || cp "$dir/PROFILE.md" "teams/$p/PROFILE.md"
    [[ -f "teams/$p/skills.txt" ]] || cp "$dir/skills.txt" "teams/$p/skills.txt"
    n=0
    while read -r name; do
      [[ -z "$name" || "$name" == \#* ]] && continue
      src=""
      for cand in "$HOME/.agents/skills/$name" "$HOME/.claude/skills/$name"; do
        [[ -d "$cand" ]] && { src="$(cd "$cand" && pwd -P)"; break; }
      done
      if [[ -z "$src" ]]; then missing+=("$p:$name"); continue; fi
      ln -sfn "$src" "teams/$p/.claude/skills/$name"
      n=$((n+1))
      if (( CONFINE )) && [[ -L "$HOME/.claude/skills/$name" ]]; then
        rm "$HOME/.claude/skills/$name"
      fi
    done < "teams/$p/skills.txt"
    echo "teams/$p -> $n skills linked"
  done
  if (( ${#missing[@]} )); then
    echo
    echo "not installed on this machine (find them on https://skills.sh, then: npx skills add <owner/repo>):"
    printf '  %s\n' "${missing[@]}"
  fi
  (( CONFINE )) && echo "confined: linked skills removed from ~/.claude/skills (restart Claude Code)"
fi

if [[ "${CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:-}" != "1" ]]; then
  echo
  echo "Set CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 in your shell rc, then restart the terminal."
fi
echo
echo "Done. /hivemind bootstraps the rest."
