#!/usr/bin/env bash
# Verifies that all "as any" casts on locals/runtime have been retired.
# Used as the phase gate for INFRA-03 (Plan 16-02).
# Exits 0 if no casts remain, non-zero if any cast variant is found.

set -euo pipefail

PATTERNS=(
  '(context\.locals as any)\.runtime'
  '(Astro\.locals as any)\.runtime'
  'rawLocals as any'
  'locals as any'
)

EXIT_CODE=0
FOUND_ANY=0

for pattern in "${PATTERNS[@]}"; do
  # -E for extended regex, -r recursive, -n line numbers, --include for .ts and .astro only
  if matches=$(grep -E -rn --include='*.ts' --include='*.astro' "$pattern" src/ 2>/dev/null); then
    if [ -n "$matches" ]; then
      echo "FAIL: pattern '$pattern' still present in src/"
      echo "$matches"
      echo ""
      FOUND_ANY=1
      EXIT_CODE=1
    fi
  fi
done

if [ "$FOUND_ANY" -eq 0 ]; then
  echo "OK: no cast variants found in src/"
fi

exit "$EXIT_CODE"
