#!/bin/sh
#
# New participant frontend (frontend_new): unit tests, architecture check and
# type check. Requires Node.js >= 22 (node --test with glob patterns).
# No backend needed. Run from the repo root.

if [ ! -d "frontend_new/tests/unit" ]; then
    echo "Error: This script must be run from the root directory of the project."
    exit 1
fi

cd frontend_new || exit 1
node --test "tests/unit/*.test.js" || exit 1
node tools/check-architecture.mjs || exit 1
npm run typecheck || exit 1
