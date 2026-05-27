#!/usr/bin/env bash
# Generates MANIFEST.sha256 for the validator skill.
# Lists every tracked file under bin/ + checks/ + SKILL.md (if present).
# Run at release time before `hermes skills publish`.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=MANIFEST.sha256
TMP=$(mktemp)

{
  find bin -type f -name '*.js' 2>/dev/null | sort
  find checks -type f -name '*.md' 2>/dev/null | sort
  [ -f SKILL.md ] && echo SKILL.md
} | while read -r f; do
  sha=$(shasum -a 256 "$f" | awk '{print $1}')
  printf '%s  %s\n' "$sha" "$f"
done > "$TMP" || true

mv "$TMP" "$OUT"
echo "Wrote $OUT ($(wc -l < "$OUT" | tr -d ' ') entries)"
