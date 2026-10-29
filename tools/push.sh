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
  echo "== check ==" && "$WAC" check . || exit 1
  echo "== test/wac ==" && "$WAC" test test/wac || exit 1
  echo "== deno ==" && deno test -A --unstable-net --no-check test/ || exit 1
  if git push -u origin "$branch"; then exit 0; fi
  echo "== push refused: merging what landed and going again ($attempt) =="
done
exit 1
