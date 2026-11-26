#!/bin/sh
#
# Participant frontend: unit tests, architecture check and type check.
# Requires Node.js >= 22 (node --test with glob patterns).
# No backend needed. Run from the repo root.

if [ ! -d "frontend/tests/unit" ]; then
    echo "Error: This script must be run from the root directory of the project."
    exit 1
fi

cd frontend || exit 1
node --test "tests/unit/*.test.js" || exit 1
node tools/check-architecture.mjs || exit 1
npm run typecheck || exit 1
