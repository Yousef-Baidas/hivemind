# cli craft

Windows specifics for a Node CLI that installs files, links folders and spawns tools. No PowerShell skill qualified, so this page is the playbook. Sources: Microsoft Learn "Naming Files, Paths, and Namespaces" and "Hard links and junctions"; Node `fs`, `child_process` and `path` docs; CVE-2024-27980.

## Junctions

- `fs.symlinkSync(target, link, "junction")` makes a directory junction without admin rights; a plain directory symlink needs Developer Mode or admin. Use a junction for folders.
- A junction target must be absolute. Resolve it with `path.resolve` first.
- Test `lstatSync(p).isSymbolicLink()` before any recursive delete; remove a junction as a link (`fs.unlinkSync` or `fs.rmdirSync`), never by recursing into its target.
- `fs.realpathSync` follows a junction; `lstat` does not. Compare both when confining a path.

## Names and case

- NTFS is case-insensitive and case-preserving. Compare paths after `path.resolve` and lowercasing on win32 only.
- Drive-letter case differs between sources (`C:\` and `c:\`). Normalise before `startsWith` checks.
- 8.3 short names (`PROGRA~1`, `RUNNER~1`) can name the same folder as the long path. Call `fs.realpathSync.native` before comparing.
- Reserved names (`CON`, `NUL`, `COM1`) and trailing dots or spaces are invalid; reject them in any name taken from input.
- Keep paths short for the tools a CLI spawns (git, PowerShell, cmd): the 260-character limit bites them. Node's `fs` adds the `\\?\` namespace to absolute paths itself on win32.

## Environment

- `%TEMP%` lives inside the user profile, so a temp dir and `HOME` share a root. Tests that set `HOME` must also set `USERPROFILE`.
- Files written by the installer use LF; `.gitattributes` decides checkout line endings. A script read back from disk may carry CRLF, so split on `/\r?\n/`.

## Spawning

- Since the CVE-2024-27980 fix, `execFileSync` on a `.cmd` or `.bat` without `shell: true` throws `EINVAL`. Run `node` or an `.exe` directly; never add `shell: true` to work around it.
- Every call passes an args array, `windowsHide: true` and a `timeout`.
- `.ps1` files run through `powershell -NoProfile -ExecutionPolicy Bypass -File`, with the args array intact.
