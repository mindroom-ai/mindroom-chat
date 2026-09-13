# Skill: cinny-live-test

Run Playwright browser tests against live Cinny at `http://localhost:8090`.
Use this after ANY Cinny code change to verify it works with real browser + real Matrix server.

## Quick Start — Run Existing Tests

```bash
bash .claude/skills/cinny-live-test/run-live-tests.sh [filter] [playwright-args]
```

**Filters:** `smoke` (Tier 1, no creds), `login`/`rooms` (Tier 2, needs creds), `threads` (Tier 3, needs creds + fixtures)

## Writing Bespoke Tests

Don't just run the canned tests — **write your own** to verify your specific change.
Use the existing specs in `e2e/live/` as templates.

### Minimal bespoke test

Create a file like `e2e/live/my-check.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test('verify my change works', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Take a screenshot for visual verification
  await page.screenshot({ path: 'test-results/my-change.png', fullPage: true });

  // Check specific DOM elements
  const element = await page.locator('.my-component');
  await expect(element).toBeVisible();

  // Check text content
  await expect(element).toContainText('Expected text');
});
```

Run it:
```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=$(which chromium) \
  E2E_NO_WEB_SERVER=1 \
  E2E_BASE_URL=http://127.0.0.1:8090 \
  npx playwright test e2e/live/my-check.spec.ts --reporter=line
```

### Taking Screenshots

```typescript
// Full page screenshot
await page.screenshot({ path: 'test-results/full-page.png', fullPage: true });

// Element-specific screenshot
const sidebar = page.locator('nav.sidebar');
await sidebar.screenshot({ path: 'test-results/sidebar.png' });

// Screenshot on failure (automatic if you use test fixtures)
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== 'passed') {
    await page.screenshot({ path: `test-results/failure-${testInfo.title}.png`, fullPage: true });
  }
});
```

Screenshots are saved to `test-results/` — examine them to verify visual correctness.

### Inspecting DOM & Console

```typescript
// Capture console errors
const errors: string[] = [];
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

// Check for React error boundaries
const errorBoundary = page.locator('text=Unexpected Application Error');
await expect(errorBoundary).not.toBeVisible();

// Wait for Matrix sync to complete (room list appears)
await page.waitForSelector('[role="listbox"]', { timeout: 30000 });

// Inspect network requests
const [response] = await Promise.all([
  page.waitForResponse(resp => resp.url().includes('/_matrix/client')),
  page.click('.some-action'),
]);
console.log('Matrix response:', response.status());
```

### Login Helper (for Tier 2+ tests)

```typescript
import { loginToMindroom } from '../helpers/auth';

test('my test needing auth', async ({ page }) => {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  if (!username || !password) { test.skip(); return; }

  // Navigate to login and authenticate
  await page.goto(`/login/${encodeURIComponent('https://mindroom.lab.mindroom.chat')}/`);
  await page.fill('[name="usernameInput"]', username);
  await page.fill('[name="passwordInput"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/home', { timeout: 30000 });

  // Now do your checks
  await page.screenshot({ path: 'test-results/after-login.png' });
});
```

### Thread & Room Inspection

```typescript
// Navigate to a specific room
await page.click('[data-room-name="My Room"]');
await page.waitForSelector('.room-timeline', { timeout: 10000 });

// Open thread panel
const threadIndicator = page.locator('[data-thread-indicator]').first();
await threadIndicator.click();

// Screenshot the thread view
await page.screenshot({ path: 'test-results/thread-view.png' });

// Check thread message count
const messages = page.locator('.thread-timeline .message');
const count = await messages.count();
console.log(`Thread has ${count} messages`);
```


## Local Test Server

Tests run against the local Tuwunel (Matrix) server at `https://mindroom.lab.mindroom.chat`
(reverse-proxied from `127.0.0.1:8008`). This avoids hitting the production `mindroom.chat` server.

- **Registration:** Token-gated via `MINDROOM_REGISTRATION_TOKEN` env var
- **Direct API access:** `http://127.0.0.1:8008/_matrix/client/v3/...`
- **Federation:** Disabled (local-only)
- **Domain:** `mindroom.lab.mindroom.chat` (NixOS Caddy → Tuwunel on port 8008)
## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `E2E_USERNAME` / `E2E_PASSWORD` | Login credentials | Tier 2+ |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Override browser path | Auto-detected |
| `E2E_BASE_URL` | App URL (default: `http://127.0.0.1:8090`) | No |
| `E2E_HOMESERVER` | Matrix server (default: `https://mindroom.lab.mindroom.chat`) | No |
| `E2E_NO_WEB_SERVER` | Skip Vite startup (default: 1) | No |

## Tips

- **Always take screenshots** of the UI state you're verifying — they prove your fix works
- **Use `fullPage: true`** for layout changes, element-specific screenshots for component changes
- **Check `test-results/`** directory after running — screenshots and traces live there
- **Console errors matter** — capture them and check for `Unexpected Application Error`
- **Matrix sync takes time** — use `waitForSelector` with generous timeouts (10-30s)
- **Existing specs are templates** — copy and modify `e2e/live/smoke.spec.ts` as starting point
- **The DOM may differ from what mocks assume** — that's the whole point of live testing

---

## Manual Browser Testing (MindRoom Agent Browser Tool)

When using the MindRoom agent's browser tool (not Playwright E2E tests), follow this workflow:

### Login Flow
1. Navigate to `http://localhost:8090/login/http%3A%2F%2Flocalhost%3A8008`
   - The URL must encode the homeserver as `http://localhost:8008` (local Tuwunel)
   - Using just `localhost:8008` without protocol won't show username/password fields
2. Type username into `[name="usernameInput"]` field
3. Type password into `[name="passwordInput"]` field  
4. Click Login button
5. Wait 8s for initial sync to complete

### Test Account
- Username: `e2e-test-bot`
- Password: `e2e-test-pw-2026`
- Homeserver: `http://localhost:8008` (local Tuwunel/Conduwuit)
- Registration: via `/run/agenix/registration-token` (requires sudo)

### Navigating to a Room
- URL pattern: `http://localhost:8090/!ROOM_ID:mindroom.lab.mindroom.chat`
- First visit shows "lobby" — click "View" button to enter
- Wait 5s after entering for timeline to load

### Thread Test Room
- Room ID: `!TFs182DGokWnICCUm6:mindroom.lab.mindroom.chat`
- Has 2 threads with replies (created for CINNY-006 debugging)
- Thread counts should show: 2 unresolved, 0 resolved, 2 total

### Creating Test Data via API
```bash
TOKEN='<access_token_from_registration>'
# Create room
curl -s http://localhost:8008/_matrix/client/v3/createRoom \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Test Room","preset":"public_chat"}'
# Send thread root
curl -s http://localhost:8008/_matrix/client/v3/rooms/$ROOM_ID/send/m.room.message/msg1 \
  -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"msgtype":"m.text","body":"Thread root"}'
# Reply in thread
curl -s http://localhost:8008/_matrix/client/v3/rooms/$ROOM_ID/send/m.room.message/reply1 \
  -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"msgtype":"m.text","body":"Reply","m.relates_to":{"rel_type":"m.thread","event_id":"$ROOT_EVENT_ID","is_falling_back":true,"m.in_reply_to":{"event_id":"$ROOT_EVENT_ID"}}}'
```

### What to Check
1. **Thread counts**: Should show real numbers, not `(-)`
2. **Console logs**: Check for `/rooms/{roomId}/threads` HTTP requests (should return 200)
3. **No "Retry" button**: If "Retry loading room threads" appears, thread loading is broken
4. **Screenshots**: Always take and send screenshots for verification

### Key Lesson from CINNY-006
`startClient()` in matrix-js-sdk **replaces** `clientOpts` entirely. If `threadSupport: true`
is only passed to `createClient()` but not `startClient()`, it gets silently overwritten.
Always verify SDK config reaches runtime by checking browser console for actual API calls.
Mocked unit tests CANNOT catch this class of bug.
