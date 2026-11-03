#!/usr/bin/env bash
# Check and test, then push only if all of it passed. Merge and go again if someone got there first.
#
# This is the whole gate, and it is meant to stay small: the package is a few thousand lines with no
# dependencies beyond the `std` and `core` built into `wac`, so its own tests are the whole of what a
# change here can break. wac's gate is not run; the commit wac pins is moved there, through that gate.
#
# Usage: tools/push.sh        (`$WAC` names the `wac` to run, the one on PATH otherwise)
set -uo pipefail
cd "$(dirname "$0")/.."
WAC="${WAC:-wac}"
export WAC

# A dirty tree is refused: the tests would pass against the working copy and the push would carry the
# last commit, reporting success for work that never left the machine.
if [ -n "$(git status --porcelain)" ]; then
  echo "== uncommitted changes: commit them first, or the push will not include them =="
  git status --short
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
for attempt in 1 2 3; do
  git fetch -q origin "$branch" 2>/dev/null && { git merge -q --no-edit "origin/$branch" || exit 1; }
  # **check and test/wac run beside the Deno tests**, the long half — about 40s, mostly Chromium waiting on pages.
  # The two wac steps read the sources and write nothing the Deno tests read (those build under `.cache/pages/`
  # and temporary directories), so every verdict is still required and none waits on another. Measured on 4
  # cores, 2026-11-03: about 60s in a row.
  out="$(mktemp -d)"
  "$WAC" check . > "$out/check" 2>&1 & checkPid=$!
  "$WAC" test test/wac > "$out/wac" 2>&1 & wacPid=$!
  echo "== deno ==" && deno test -A --unstable-net --no-check test/; denoStatus=$?
  wait "$checkPid"; check=$?
  wait "$wacPid"; tested=$?
  echo "== check ==" && cat "$out/check"
  echo "== test/wac ==" && cat "$out/wac"
  rm -rf "$out"
  [ "$check" -eq 0 ] && [ "$tested" -eq 0 ] && [ "$denoStatus" -eq 0 ] || exit 1
  if git push -u origin "$branch"; then exit 0; fi
  echo "== push refused: merging what landed and going again ($attempt) =="
done
exit 1
