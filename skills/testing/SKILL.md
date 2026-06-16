# Testing Orchestration Skill

Use this skill to decide and run the correct TRAC test suite for a requested change.

## Use When
- The user asks to test, validate, or verify behavior.
- A code change requires confidence checks before completion.

## Do Not Use For
- Implementing feature code without test execution.

## Required Workflow
1. Classify test scope from change type:
   - Backend logic only -> backend unit tests first.
   - Backend + DB behavior -> backend integration tests.
   - User-facing flow/pathing/UI -> frontend E2E tests.
2. Prefer repository test entry scripts from project root:
   - `./test_backend_unit.sh`
   - `./test_backend_integration.sh`
   - `./test_e2e.sh`
3. For integration and E2E suites, ensure required services are running first (recommended: `./run_dev_nginx_both.bash` in another terminal).
4. If environment prerequisites are missing, report exactly what is missing and stop before unsafe assumptions.
5. Return concise test evidence: command run, pass/fail, and first failing location if any.

## Quality Checks
- Unit tests do not depend on live frontend/backend services.
- Integration tests require backend services to be running.
- E2E tests run with required services available.
