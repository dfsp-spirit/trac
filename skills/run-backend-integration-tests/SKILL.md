# Run Backend Integration Tests Skill

Use this skill when the user asks to run backend integration tests that cover API/database interactions.

## Triggers
- "run backend integration tests"
- "run integration tests"
- "verify backend with db"

## Steps
1. Confirm repository root is current working directory.
2. Execute `./test_backend_integration.sh`. It is self-contained: it prepares a
   disposable test database, starts a backend that points at it, runs pytest and
   removes both again. Do not start the dev stack for it, and never run the
   integration tests against the development database.
3. Pass extra pytest selectors through, e.g. `./test_backend_integration.sh -k diary`.
4. If the script cannot obtain a database, report what is missing: either
   `TUD_TEST_DATABASE_URL`, a database role allowed to `CREATE DATABASE`, or docker
   for the throwaway container.
5. Return test outcome with failing test names/paths when applicable.

## Expected Output
- Command executed
- Pass/fail summary
- First actionable failure details if failed
