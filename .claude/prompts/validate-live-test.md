# Validate cinny-live-test Skill — Bespoke Test + Screenshots

You are validating the `$cinny-live-test` skill by writing and running a bespoke Playwright test.

## Your Task

1. **Read the skill:** `.claude/skills/cinny-live-test/skill.md`
2. **Run existing smoke tests** first: `bash .claude/skills/cinny-live-test/run-live-tests.sh smoke`
3. **Write a bespoke test** at `e2e/live/bespoke-validation.spec.ts` that:
   - Loads the app at `http://localhost:8090`
   - Takes a full-page screenshot at `test-results/validation-full.png`
   - Verifies the login form has username + password fields
   - Takes a screenshot of just the login form at `test-results/validation-login-form.png`
   - Captures any console errors and logs them
   - Checks there's no "Unexpected Application Error" visible
4. **Run your bespoke test:**
   ```bash
   PLAYWRIGHT_CHROMIUM_EXECUTABLE=$(which chromium) \
     E2E_NO_WEB_SERVER=1 \
     E2E_BASE_URL=http://127.0.0.1:8090 \
     npx playwright test e2e/live/bespoke-validation.spec.ts --reporter=line
   ```
5. **Verify screenshots exist** in `test-results/` and describe what they show
6. **Write results** to `REPORT.md`:
   - Did smoke tests pass?
   - Did your bespoke test pass?
   - What do the screenshots show?
   - Any issues with the skill docs or workflow?
7. **Clean up:** Delete `e2e/live/bespoke-validation.spec.ts` (it was just for validation)
8. **Commit** `REPORT.md` with message `validate: cinny-live-test skill bespoke test + screenshots`
