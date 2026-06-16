# Run Frontend E2E Tests Skill

Use this skill when the user asks to run frontend end-to-end tests or validate full user flows.

## Triggers
- "run frontend tests"
- "run e2e tests"
- "verify ui flow"

## Steps
1. Confirm repository root is current working directory.
2. Ensure frontend/backend/proxy services are running before tests (recommended: start `./run_dev_nginx_both.bash` in another terminal and keep it running).
3. Execute `./test_e2e.sh`.
4. If script prerequisites fail, report the missing running services/setup and how to start them.
5. Return test outcome with failing spec paths when applicable.

## Expected Output
- Command executed
- Pass/fail summary
- First actionable failure details if failed
