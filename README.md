# Hermes Mastery Validator

The validator skill for the [Hermes Mastery course](https://s1dd4rth.github.io/hermes-mastery/). A zero-dependency Node CLI that emits a deterministic JSON envelope per course module (M1–M10), used by the course web app to apply check results to your progress.

## Install (v0.1.0-alpha)

Hub install (`hermes skills install s1dd4rth/hermes-mastery-validator`) is **not available** in v0.1.0-alpha — clawhub.ai is the OpenClaw skill registry, and the Hermes-side Hub publishing path is undocumented in Hermes v0.12.0. Instead, clone + symlink:

```bash
cd ~ && git clone https://github.com/s1dd4rth/hermes-mastery-validator.git
ln -sfn ~/hermes-mastery-validator ~/.hermes/skills/hermes-mastery-validator
cd ~/hermes-mastery-validator && npm install   # for the single js-yaml dep
```

The validator now appears in Hermes as a normal installed skill. Verify via `hermes skills` — the listing should include `hermes-mastery-validator`.

Hub install will be explored for v0.2.0 once the Hermes-side publishing path is documented.

## Use

Per module: ask the agent to run `verify_module` for module N (1–10), per the skill's [SKILL.md](SKILL.md) contract. The agent replies with one JSON object wrapped in a ` ```json ` fenced block. Paste that into the course web app's paste-validator panel.

For a full audit:

```bash
node bin/verify.js all
```

Output: `INTEGRITY: {…}` followed by a 10-line per-module summary.

To run a single module directly:

```bash
node bin/verify.js 1
```

## How it works

- `bin/verify.js` is the validator CLI; `MODULE_RUNNERS[1..10]` dispatch per module.
- Module checks read `~/.hermes/{config.yaml,memories/*,SOUL.md,skills/*,cron/jobs.json,profiles/writer/*,logs/curator/*}` to evaluate the learner's setup state. **No credential values are ever logged**; the OAuth token file is `stat`-only.
- The JSON envelope's `integrity` field uses `MANIFEST.sha256` to detect drift (see spec §7.2 v4).
- M10 aggregates M1–M9 into a deterministic `HMS-<base32>` completion code.

## Course

- **Web app:** <https://s1dd4rth.github.io/hermes-mastery/>
- **Spec (v4):** [docs/superpowers/specs/2026-05-22-hermes-mastery-design.md](https://github.com/s1dd4rth/openclaw-mastery/blob/main/docs/superpowers/specs/2026-05-22-hermes-mastery-design.md)
- **Plan (v2):** [docs/superpowers/plans/2026-05-23-hermes-mastery-build.md](https://github.com/s1dd4rth/openclaw-mastery/blob/main/docs/superpowers/plans/2026-05-23-hermes-mastery-build.md)
- **Launch checklist (v0.1.0-alpha):** [docs/superpowers/launch-checklists/2026-05-28-hermes-v0.1.0-alpha.md](https://github.com/s1dd4rth/openclaw-mastery/blob/main/docs/superpowers/launch-checklists/2026-05-28-hermes-v0.1.0-alpha.md)
- **Contributor dev workflow:** [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT — see [LICENSE](LICENSE).
