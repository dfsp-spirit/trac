#!/bin/sh
#
# Frontend unit tests (node:test). Requires Node.js >= 20.
# No backend needed. Run from the repo root.

if [ ! -d "frontend/tests/unit" ]; then
    echo "Error: This script must be run from the root directory of the project."
    exit 1
fi

cd frontend && exec node --test --import ./tests/unit/setup.js tests/unit/*.test.js
