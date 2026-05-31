---
name: hermes-mastery-validator
description: Validator skill for the Hermes Mastery course. Runs `verify.js N` and replies with one JSON object per module.
version: 0.1.0-alpha.3
---

# Hermes Mastery — Course Validator

## When to use this skill

Trigger this skill when the user says any of:

- "Use hermes-mastery-validator to verify module N" (where N is 1–10)
- "Run the course validator for module N"
- "Check my setup for module N"
- Any equivalent phrasing that asks to verify a specific Hermes Mastery module

## What you MUST do when triggered

These are imperative instructions for the LLM agent loading this skill. Do them in order, every time.

**1. Identify the module number** from the user's request. If unclear, ask. Valid range: 1–10.

**2. Run the bundled CLI ONCE.** This skill ships an executable Node script at `bin/verify.js` (in this skill's directory). It does all the work — recipe parsing, command execution, result aggregation, JSON output — without any LLM in the loop. Your job is to invoke it and return its output.

Use your bash tool to run:

```
node ~/.hermes/skills/hermes-mastery-validator/bin/verify.js <N>
```

(replacing `<N>` with the module number).

If the user installed the skill at a non-default path, adjust the path accordingly. The skill directory always contains `bin/verify.js`, `SKILL.md`, and `checks/`.

**3. Return the CLI's stdout as a single fenced ```json code block — that is your entire reply.** Take the exact JSON the CLI printed and wrap it in one ` ```json ` fenced code block. Nothing before it, nothing after it. No sentence introducing it, no summary following it, no bullets, no bold, no table.

Like this, and ONLY this:

````
```json
{"tool":"hermes-mastery.verify_module", ... the exact CLI stdout ... }
```
````

**Why a code block, not raw text, and not a summary.** You may have a USER.md / SOUL.md / persona that tells you to format replies with bullets, bold, and directness. A fenced code block *is* a formatting element — it satisfies that instinct — but its contents are preserved byte-for-byte and never reformatted. That is the point: the code block is the channel that lets you "present" the result without destroying it. Putting the JSON in a ```json block is REQUIRED. Turning it into a bullet list / "Pass/Fail" table / prose summary is the one failure that breaks the web app — the parser then has no JSON to read and the verification silently fails. The user built this skill to get JSON back; a formatted summary is not the deliverable.

The web app parser strips the ```json fence automatically, so the fenced block pastes in and parses correctly. Do not also paste a summary — just the one code block.

**Safety net.** The CLI also writes the exact same JSON to `~/.hermes/hermes-mastery-last.json`. That is a backup for recovery only — the *intended* flow is the fenced block in your reply. If the user ever reports the verification "isn't returning JSON", tell them they can `cat ~/.hermes/hermes-mastery-last.json` to recover the untouched payload.

That's the entire flow: ONE bash call, ONE ```json code block as the whole reply. If you're tempted to make additional tool calls, run another bash command, or add ANY prose/bullets/summary around the code block, you're doing it wrong.

## What you MUST NOT do

- Do NOT read the recipe files (`checks/m*.md`) yourself and try to execute checks one-by-one. That's the OLD architecture — it was unreliable. The CLI does all execution now.
- Do NOT add prose, summaries, or "Here are the results:" before or after the ```json block. The block is the entire reply.
- Do NOT make multiple bash calls. ONE call to `verify.js`, that's it.
- Do NOT modify the JSON inside the block — pass the CLI stdout through byte-for-byte.
- Do NOT turn the JSON into your USER.md / SOUL.md / persona format (bullets, bold, directness, Pass/Fail table). It is a machine-parsed payload. A ```json fenced block is the correct way to "present" it losslessly; a reformatted summary destroys it. This is THE single most common failure: the agent runs the CLI correctly, then "presents the results nicely" as a bulleted summary, and the JSON is lost. The fenced code block is how you present it nicely AND keep it parseable — use it.

## Why this design

Earlier versions of this skill asked the LLM agent to read the recipe markdown and execute each bash command sequentially. That worked for trivial modules but failed reliably on M1's multi-check sequence — agents tended to stop after 1–2 commands and never produce the final JSON. The CLI approach moves all execution into deterministic Node code; the agent's only job is to invoke it and pass through the output. Same JSON contract, same recipe markdown (kept as docs), reliable end-to-end.

## Purpose (context)

Verify the user's Hermes setup against the Hermes Mastery course checklist for a given module. Returns structured JSON the Hermes Mastery web app can parse, or that the user can paste back into the web app as a fallback.

## Prerequisites

Recipes assume a Unix-y shell environment. Make sure these are on the host running Hermes:

| Tool | Used for | Install if missing |
|---|---|---|
| `bash` | shell for running recipe commands | comes with macOS, Linux; on Windows use WSL2 |
| `git` | n/a — only for installing this skill itself | preinstalled on macOS, Linux, WSL2 |
| `grep`, `sed`, `stat` | identity-file inspection (M1, M2, M5–M9) | preinstalled on macOS, Linux, WSL2; macOS uses BSD `stat` (recipes branch on `uname -s`) |
| `jq` | parsing structured CLI output (M3, M4, M5, M6, M9) | `brew install jq` (macOS) / `apt install jq` (Debian/Ubuntu) / `dnf install jq` (Fedora) |

If a check fails because a prerequisite is missing, the recipe surfaces the error in `detail` and `pass: false` — re-run after installing the dep.

## Platform support

| Platform | Status |
|---|---|
| **Linux** (generic distros) | Supported. |
| **macOS** (Mac mini, Apple Silicon or Intel) | Supported. `stat` syntax is auto-detected. |
| **Windows via WSL2** | Supported. Behaves like Linux for the validator. |
| **Windows native** | Not supported. Recipes need POSIX shell + GNU/BSD coreutils that don't exist in `cmd.exe` or PowerShell natively. Use WSL2. |

## Authorized scope (insider authorization model)

This skill performs read-only introspection of course-relevant state. By installing it, the user authorizes these specific operations on their own Hermes instance.

**Authorized:**

- Read Hermes config values by parsing `~/.hermes/config.yaml` directly (via js-yaml)
- Read identity files (`SOUL.md`, `USER.md`, `MEMORY.md`) in the user's `~/.hermes/memories/` directory
- Run `hermes` CLI commands that surface non-secret configuration state
- List cron jobs (names, schedules, delivery channels — never the prompt bodies)
- List installed skills, channels, and named agents
- Check file permissions via `stat` (never read or display the file contents)

**NOT authorized:**

- Display any secret value (gateway tokens, API keys, passwords, the contents of any `.env` or credentials file)
- Modify any configuration, file, cron job, channel, skill, or agent
- Send any message on any channel
- Initiate outbound network requests except to the local gateway

If asked to do anything outside the authorized list, refuse and explain what scope this skill operates under.

## Tool: `verify_module`

Invoke as: `Use hermes-mastery-validator to verify module N` (where N is 1-10).

The skill loads the per-module recipe from `checks/m<N>.md`, runs each check in the order listed, and returns ONE JSON object matching the contract below, wrapped in a single ```json fenced code block as the entire reply. No commentary, no summary, nothing outside that one block.

### Output contract (schema_version 1)

```json
{
  "tool": "hermes-mastery.verify_module",
  "schema_version": 1,
  "module": 1,
  "checked_at": "2026-05-23T09:36:53Z",
  "validator_version": "0.1.0-alpha.0",
  "platform": "macos",
  "checks": [
    {
      "id": "hermes-installed",
      "pass": true,
      "detail": "Hermes Agent v0.12.0 (2026.4.30)",
      "evidence": { "version": "Hermes Agent v0.12.0 (2026.4.30)" },
      "fix_prompt": null
    },
    {
      "id": "validator-skill-installed",
      "pass": null,
      "detail": "Requires LLM judgment — manual toggle retained",
      "evidence": null,
      "fix_prompt": null,
      "manual": true
    }
  ],
  "integrity": {
    "source": "local-manifest",
    "status": "DRIFT_OK"
  }
}
```

### Field rules

- **Always emit valid JSON inside one ```json fenced code block, with no commentary or summary outside that block.** This is the most important rule. The parser strips the fence and reads the JSON; it canNOT recover anything from a reformatted prose/bullet summary.
- `schema_version` is integer `1` for this skill version.
- `module` is integer 1–10.
- `checked_at` is ISO 8601 UTC.
- `validator_version` matches the `VERSION` file.
- `platform` is `"macos"` or `"linux"` based on `uname -s` (`Darwin` → `macos`, `Linux` → `linux`).
- `pass`: `true` if check verifiably succeeded, `false` if it verifiably failed, `null` only if `manual: true` (judgment or attestation that this validator cannot decide).
- `detail` is always present, terse, one sentence.
- `evidence` is optional, opaque, used for debug display in the web app. **Never include secret values in evidence.**
- `fix_prompt` is the canonical fix the user can copy back into their Hermes chat. Pull from the per-module recipe. `null` on pass.
- `manual: true` is set on judgment/attestation checks; `pass` must be `null` in that case.
- `integrity` is always present: `{ source, status, modified_files? }` per spec §7.2.

### Error handling

- If a CLI command needed for a check is unavailable, return `pass: false` with the error in `detail`.
- If a config key is unset, treat it as the documented default; if no default is documented, return `pass: false` with `detail: "config key <X> is unset"`.
- If the recipe is unclear or contradicts what you observe on the system, return `pass: false` with `detail: "recipe-system mismatch: <observation>"` and explain in evidence. Do NOT guess.

## Platform handling

At the start of every `verify_module` invocation, run `uname -s` ONCE and remember the result for the duration of the run. Branch any platform-conditional command on it:

| Operation | Linux (uname -s = Linux) | macOS (uname -s = Darwin) |
|---|---|---|
| Read file mode | `stat -c "%a" <path>` | `stat -f "%A" <path>` |

Set the response's top-level `platform` field accordingly.

## Module recipes (v0.1.0-alpha scope)

| N | File | Deterministic | Manual | Notes |
|---|---|---|---|---|
| 1 | `checks/m1.md` | 4 | 0 | Install and Configure. hermes-installed, skill-registered, model-configured, validator-skill-installed. |
| 2–10 | TBD (Phase 2/3) | — | — | Populated in later build phases. |

Calling `verify_module(N)` for any N outside 1..10 returns `{checks: [], detail: "module N out of range"}` with `module` set and an empty checks array.

## Standalone use (outside the course)

Anyone running Hermes can install this skill and use it to audit their own setup against the Mastery curriculum's hardening checklist. The web app integration is optional — the JSON output is human-readable enough on its own.
