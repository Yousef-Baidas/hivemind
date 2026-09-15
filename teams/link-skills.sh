#!/usr/bin/env bash
# Link each profile's skills into teams/<profile>/.claude/skills/.
# Run from the repo root. Copied here by hivemind's install.sh --project;
# hive-scout re-runs it after rewriting a skills.txt.
#
#   bash teams/link-skills.sh              link what is already on this machine
#   bash teams/link-skills.sh --install    also `npx skills add` anything missing
#   bash teams/link-skills.sh --confine    also drop ~/.claude/skills/<name> links
#                                          so the lead never loads them
#
# skills.txt line format:  <owner/repo> <skill-name>
set -euo pipefail

INSTALL=0; CONFINE=0
for a in "$@"; do
  case "$a" in
    --install) INSTALL=1 ;;
    --confine) CONFINE=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done
[[ -d teams ]] || { echo "no teams/ here; run from the repo root" >&2; exit 1; }

find_src() {
  local name="$1" cand
  for cand in "$HOME/.agents/skills/$name" "$HOME/.claude/skills/$name"; do
    [[ -d "$cand" ]] && { (cd "$cand" && pwd -P); return 0; }
  done
  return 1
}

missing=()
for dir in teams/*/; do
  p="$(basename "$dir")"
  [[ -f "$dir/skills.txt" ]] || continue
  mkdir -p "$dir/.claude/skills"
  n=0
  while read -r source name _; do
    [[ -z "${source:-}" || "$source" == \#* ]] && continue
    [[ -z "${name:-}" ]] && { echo "teams/$p/skills.txt: line needs '<owner/repo> <skill>': $source" >&2; continue; }
    if ! src="$(find_src "$name")"; then
      if (( INSTALL )); then
        npx -y skills add "$source" --skill "$name" -g -y -a claude-code >/dev/null 2>&1 || true
        src="$(find_src "$name" || true)"
      fi
      if [[ -z "${src:-}" ]]; then missing+=("$p: npx skills add $source --skill $name -g -y"); continue; fi
    fi
    ln -sfn "$src" "$dir/.claude/skills/$name"
    n=$((n+1))
    if (( CONFINE )) && [[ -L "$HOME/.claude/skills/$name" ]]; then rm "$HOME/.claude/skills/$name"; fi
  done < "$dir/skills.txt"
  echo "teams/$p -> $n skills linked"
done

if (( ${#missing[@]} )); then
  echo
  echo "missing; install then re-run (or pass --install):"
  printf '  %s\n' "${missing[@]}"
fi
(( CONFINE )) && echo "confined: linked skills removed from ~/.claude/skills (restart Claude Code)"
exit 0
