# Contributing to hermes-mastery-validator

## Dev workflow

Hermes does NOT support `hermes skills install /local/path` — it routes the
path to Hub source adapters and returns garbage. Instead, **symlink** this
checkout into `~/.hermes/skills/`:

```bash
ln -sfn "$(pwd)" ~/.hermes/skills/hermes-mastery-validator
```

That gives the validator the canonical install path (per spec §4) while
letting you edit files in this repo and have changes pick up immediately.

## Drift evidence

The validator emits `integrity: { source, status, modified_files? }` on every
run (per spec §7.2 v4). `source` is `local-manifest` when MANIFEST.sha256 is
present (true in the symlinked dev workflow and in Hub-installed releases),
`none` otherwise. `status` is `DRIFT_OK` / `DRIFT_MODIFIED` / `UNKNOWN`.

After editing any tracked file under `bin/`, `checks/`, or `SKILL.md`,
regenerate the manifest before testing:

```bash
./scripts/generate-manifest.sh
```

If you skip this, the validator will emit `DRIFT_MODIFIED` because the file
hashes no longer match the committed manifest. The web app will surface a
"validator drift detected" banner — which is correct! It's how learners
catch a misbehaving agent that edited verify.js. As a course author, just
regenerate before committing.

## Publishing

Before publishing to agentskills.io:

1. Bump VERSION (semver)
2. `./scripts/generate-manifest.sh` to regenerate MANIFEST.sha256
3. Commit + push
4. `hermes skills publish .`

## Reference

- Spec: https://github.com/s1dd4rth/openclaw-mastery/blob/main/docs/superpowers/specs/2026-05-22-hermes-mastery-design.md
- Plan: https://github.com/s1dd4rth/openclaw-mastery/blob/main/docs/superpowers/plans/2026-05-23-hermes-mastery-build.md
- Phase 0 probe findings: https://github.com/s1dd4rth/openclaw-mastery/blob/main/docs/superpowers/probes/2026-05-23-hermes-probes.md
