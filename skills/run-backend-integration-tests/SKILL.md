# Run Backend Integration Tests Skill

Use this skill when the user asks to run backend integration tests that cover API/database interactions.

## Triggers
- "run backend integration tests"
- "run integration tests"
- "verify backend with db"

## Steps
1. Confirm repository root is current working directory.
2. Ensure backend services are running before tests (recommended: start `./run_dev_nginx_both.bash` in another terminal and keep it running).
3. Execute `./test_backend_integration.sh`.
4. If script prerequisites fail, report what service/environment is missing and how to start it.
5. Return test outcome with failing test names/paths when applicable.

## Expected Output
- Command executed
- Pass/fail summary
- First actionable failure details if failed
