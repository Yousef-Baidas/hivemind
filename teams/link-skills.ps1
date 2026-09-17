# Link each profile's skills into teams\<profile>\.claude\skills\ (junctions, no admin needed).
# Run from the repo root. Copied here by hivemind's install.ps1 -Project;
# hive-scout re-runs it after rewriting a skills.txt.
#
#   .\teams\link-skills.ps1            link what is already on this machine
#   .\teams\link-skills.ps1 -Install   also `npx skills add` anything missing
#   .\teams\link-skills.ps1 -Confine   also drop ~\.claude\skills\<name> links
#   .\teams\link-skills.ps1 -Relock    accept current hashes into teams\skills-lock.json
#
# skills.txt line format:  <owner/repo> <skill-name>
param([switch]$Install, [switch]$Confine, [switch]$Relock)
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

$missing = @(); $linked = @()
foreach ($dir in Get-ChildItem "teams" -Directory) {
    $p = $dir.Name
    # required.txt: the pipeline's mandatory skills, same format; hive-scout never rewrites it
    $lists = @("required.txt", "skills.txt") | ForEach-Object { Join-Path $dir.FullName $_ } | Where-Object { Test-Path $_ }
    if (-not $lists) { continue }
    $skillsDir = Join-Path $dir.FullName ".claude\skills"
    New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null
    $n = 0
    foreach ($line in Get-Content $lists) {
        $parts = $line.Trim() -split '\s+'
        if ($parts.Count -eq 0 -or $parts[0] -eq "" -or $parts[0].StartsWith("#")) { continue }
        if ($parts.Count -lt 2) { Write-Warning "teams/${p}: line needs '<owner/repo> <skill>': $line"; continue }
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
        $linked += "$name=$source=$src"
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

# lock: sha256 per linked skill in teams\skills-lock.json; drift keeps the committed hash unless -Relock
if ($linked.Count -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $js = @'
const fs=require("fs"),p=require("path"),c=require("crypto");
const relock=process.argv[1]==="1", lockFile="teams/skills-lock.json";
let lock={version:1,skills:{}}; try{lock=JSON.parse(fs.readFileSync(lockFile,"utf8"))}catch{}
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.name==="node_modules"||e.name===".git"?[]:e.isDirectory()?walk(p.join(d,e.name)):[p.join(d,e.name)]);
const hash=d=>{const h=c.createHash("sha256");for(const f of walk(d).sort()){h.update(p.relative(d,f).split(p.sep).join("/")+"\0");h.update(fs.readFileSync(f));h.update("\0")}return h.digest("hex")};
const drift=[];
for(const line of fs.readFileSync(0,"utf8").split(/\r?\n/).filter(Boolean)){
  const [name,source,src]=line.split("=");const h=hash(src);const old=lock.skills[name];
  if(old&&old.hash!==h&&!relock){drift.push(name);continue}
  lock.skills[name]={source,hash:h};
}
fs.writeFileSync(lockFile,JSON.stringify(lock,null,2)+"\n");
for(const d of drift)console.log("drift: "+d+"  (npx skills update "+d+", or -Relock to accept)");
console.log("lock -> "+lockFile+" ("+Object.keys(lock.skills).length+" skills"+(relock?", relocked":"")+")");
'@
    $tmp = Join-Path ([IO.Path]::GetTempPath()) "hive-lock.js"
    Set-Content -Path $tmp -Value $js
    ($linked -join "`n") | & node $tmp $(if ($Relock) { "1" } else { "0" })
    Remove-Item $tmp
}
