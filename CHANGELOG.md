# Changelog

All notable changes to the `hermes-mastery-validator` skill.

## [0.1.0-alpha.3] — 2026-05-31

### Changed
- **M10 `session-search-returns-results` manual** rewritten: `hermes search` is
  not a CLI (confirmed v0.15.1) and session search is an agent tool — the manual
  now tells the learner to ask the agent in chat (or browse `hermes dashboard`),
  not to use a dashboard search bar at `:1919`.
- **M10 `loop-honesty-check`** points at real evidence sources (`ls
  ~/.hermes/logs/curator/`, ask-the-agent session search, `hermes memory list`)
  instead of a dashboard search UI.
- **M9 `profile-delegation`** note: dropped the `v0.12.0` pin; clarified a
  delegate tool exists for subagents but there's no cross-*profile* RPC CLI.
- Dropped stale `v0.12.0` version pins from comments/docs (config-get note,
  m10.md). Verified against live Hermes v0.15.1.

### Tag

[`v0.1.0-alpha.3`](https://github.com/s1dd4rth/hermes-mastery-validator/releases/tag/v0.1.0-alpha.3).

---

## [0.1.0-alpha.2] — 2026-05-29

### Changed
- **M1 check `gateway-running` → `skill-registered`.** The old check probed a web dashboard at
  `http://127.0.0.1:1919` — an OpenClaw assumption that does not exist in Hermes. In Hermes,
  `hermes gateway` connects messaging channels and skills run inside a `hermes`/`hermes --tui`
  session, not behind a gateway. The new `skill-registered` check verifies Hermes actually
  recognizes the installed skill via `hermes skills list` (a stronger signal than the on-disk
  `SKILL.md` check). Verified against Hermes v0.15.1. The HMS- completion code is unaffected
  (it hashes per-module pass/fail counts, not check IDs).
- `hermes skills list` is invoked with a wide `COLUMNS` so the Rich table does not truncate the
  skill name ("hermes-mastery-validat…") when piped.
- `hermes-installed` and `model-configured` now emit string `detail` values (per the schema
  contract) instead of objects.

### Fixed
- `validator-skill-installed` fix text no longer references the unsupported Hub install
  (`hermes skills install s1dd4rth/...` returns "Could not fetch from any source" in v0.15.1);
  it points to the canonical clone + symlink + `npm install`.
- Dropped the stale `curl` prerequisite (no longer used — `httpProbe` had been the only consumer).

### Tag

[`v0.1.0-alpha.2`](https://github.com/s1dd4rth/hermes-mastery-validator/releases/tag/v0.1.0-alpha.2).

---

## [0.1.0-alpha.1] — 2026-05-29

### Changed
- **M10 check ID renamed: `claw-reviewed-setup` → `hermes-reviewed-setup`.** OpenClaw legacy
  name swept out. The HMS- completion code is unaffected because the canonical-form hash uses
  per-module pass/fail counts, not check IDs.
- `M9` `profile-delegation` manual prompt updated to use real Hermes invocation
  (`writer chat` / `hermes profile use writer`) instead of the spec's stale `hermes -p writer`
  (not a valid flag in Hermes v0.12.0).

### Tag

[`v0.1.0-alpha.1`](https://github.com/s1dd4rth/hermes-mastery-validator/releases/tag/v0.1.0-alpha.1) @
commit `ac34741`.

---

## [0.1.0-alpha] — 2026-05-28

Initial public release of the `hermes-mastery-validator` skill.

### Added
- **Zero-dependency Node CLI** at `bin/verify.js` (~1800 lines). Argv-style `execFileSync` for
  shell-free subprocess calls; native `fetch` for HTTP. Single explicit dep: `js-yaml` (used by
  `readYamlValue()` since Hermes v0.12.0 has no `hermes config get` subcommand — discovered
  during Phase 0 probes).
- **`MODULE_RUNNERS[1..10]` dispatch.** 10 module check functions emit a JSON envelope per
  invocation. M10 orchestrates M1–M9 in-process via subprocess (`runCmd('node', [__filename,
  String(n)])`) and aggregates results into a deterministic completion code.
- **Drift-evidence via MANIFEST.sha256** (spec §7.2 v4). Single-source `local-manifest`
  envelope (`{ source, status, modified_files?, note? }` with `DRIFT_OK / DRIFT_MODIFIED /
  UNKNOWN`). The earlier v3 `git-checkout` fallback was dropped after Phase 0 found that
  `.git/` is never present in any Hermes-installed skill.
- **`HMS-<base32>` completion code.** `M10` emits a deterministic `HMS-` prefix + 12-char
  RFC 4648 base32 of `sha256(canonical_m1_m9_tally)`. Same setup state always yields the
  same code. Smoke-tested across runs.
- **`scripts/generate-manifest.sh`** — release-time script that walks `bin/`, `checks/`,
  `SKILL.md` and writes `MANIFEST.sha256` for the drift-evidence check.
- **`SKILL.md`** with agentskills.io frontmatter (locked during Phase 0 Task 0.4: only `name`
  and `description` are required). Persona-override + fenced-block reply strategy preserved
  from the OpenClaw posture.
- **`CONTRIBUTING.md`** documenting the symlink dev workflow — `ln -sfn ~/hermes-mastery-validator
  ~/.hermes/skills/hermes-mastery-validator` — because Hermes v0.12.0 does not support
  `hermes skills install /local/path` (discovered Phase 0 Task 0.3).
- 10 recipe docs (`checks/m1.md`–`checks/m10.md`) explaining what each module's checks
  verify and how.

### Security posture
- Credential files (`~/.hermes/.env`, `~/.hermes/auth.json`, `~/.hermes/google_client_secret.json`,
  etc.) are **stat-only**, never read.
- Token-presence checks emit only `{ var, present: true }` evidence — no value capture.
- The skill-source scope grep in M8 explicitly excludes filenames matching
  `secret|token|credential|\.env` patterns.

### Known gaps (deferred to v0.2.0+)
- **Hub install via `hermes skills install s1dd4rth/hermes-mastery-validator` is BLOCKED.**
  Hermes's pre-publish security scanner flags any skill reading `~/.hermes/` paths as
  `persistence` + `exfiltration` (38 findings on `bin/verify.js`, 207 on bundled `js-yaml`).
  `clawhub.ai` is OpenClaw's registry, not Hermes's. The Hermes-side Hub publishing path is
  undocumented. Workaround: clone + symlink (see `CONTRIBUTING.md`).
- M6 `cron-fires-end-to-end`, M8 OAuth + sent-folder + calendar, M9 writer-profile distinct
  content + delegation — all require interactive user verification on a real Hermes install.
- M10 `session-search-returns-results` downgraded to manual since `hermes search` does not
  exist in v0.12.0.

### References
- Spec: [openclaw-mastery/docs/superpowers/specs/2026-05-22-hermes-mastery-design.md](https://github.com/s1dd4rth/openclaw-mastery/blob/main/docs/superpowers/specs/2026-05-22-hermes-mastery-design.md) (v4)
- Plan: [openclaw-mastery/docs/superpowers/plans/2026-05-23-hermes-mastery-build.md](https://github.com/s1dd4rth/openclaw-mastery/blob/main/docs/superpowers/plans/2026-05-23-hermes-mastery-build.md) (v2)
- Phase 0 probe findings: [openclaw-mastery/docs/superpowers/probes/2026-05-23-hermes-probes.md](https://github.com/s1dd4rth/openclaw-mastery/blob/main/docs/superpowers/probes/2026-05-23-hermes-probes.md)
