#!/usr/bin/env bash
# Link each profile's skills into teams/<profile>/.claude/skills/.
# Run from the repo root. Copied here by hivemind's install.sh --project;
# hive-scout re-runs it after rewriting a skills.txt.
#
#   bash teams/link-skills.sh              link what is already on this machine
#   bash teams/link-skills.sh --install    also `npx skills add` anything missing
#   bash teams/link-skills.sh --confine    also drop ~/.claude/skills/<name> links
#                                          so the lead never loads them
#   bash teams/link-skills.sh --relock     accept current hashes into teams/skills-lock.json
#
# skills.txt line format:  <owner/repo> <skill-name>
# teams/skills-lock.json pins each linked skill's content hash (sha256 over its files);
# a differing hash on this machine prints "drift: <skill>" and keeps the committed hash.
set -euo pipefail

INSTALL=0; CONFINE=0; RELOCK=0
for a in "$@"; do
  case "$a" in
    --install) INSTALL=1 ;;
    --confine) CONFINE=1 ;;
    --relock)  RELOCK=1 ;;
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

missing=(); linked=()
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
    linked+=("$name=$source=$src")
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

# lock
if command -v node >/dev/null 2>&1 && (( ${#linked[@]} )); then
  printf '%s\n' "${linked[@]}" | node -e '
    const fs=require("fs"),p=require("path"),c=require("crypto");
    const relock=process.argv[1]==="1", lockFile="teams/skills-lock.json";
    let lock={version:1,skills:{}}; try{lock=JSON.parse(fs.readFileSync(lockFile,"utf8"))}catch{}
    const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.name==="node_modules"||e.name===".git"?[]:e.isDirectory()?walk(p.join(d,e.name)):[p.join(d,e.name)]);
    const hash=d=>{const h=c.createHash("sha256");for(const f of walk(d).sort()){h.update(p.relative(d,f)+"\0");h.update(fs.readFileSync(f));h.update("\0")}return h.digest("hex")};
    const drift=[];
    for(const line of fs.readFileSync(0,"utf8").split("\n").filter(Boolean)){
      const [name,source,src]=line.split("=");const h=hash(src);const old=lock.skills[name];
      if(old&&old.hash!==h&&!relock){drift.push(name);continue}
      lock.skills[name]={source,hash:h};
    }
    fs.writeFileSync(lockFile,JSON.stringify(lock,null,2)+"\n");
    for(const d of drift)console.log("drift: "+d+"  (npx skills update "+d+", or --relock to accept)");
    console.log("lock -> "+lockFile+" ("+Object.keys(lock.skills).length+" skills"+(relock?", relocked":"")+")");
  ' "$RELOCK"
fi
exit 0
