import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A saved draft comes back when its room opens again, in the app or after a reload. That is not
// typing: the room hears "typing" only once the person presses a key. Runs in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver.
const PASSWORD = 'draft-restore-typing-spec-password';
const RUN = Date.now().toString(36);
const DRAFT = 'Draft for the harbor notes: the tug arrives at nine, not sent yet';
/** Long enough for a typing notice the restore would send. */
const QUIET_MS = 3_000;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

type TypingNotice = { roomId: string; typing: boolean };

const recordTypingNotices = (page: Page): TypingNotice[] => {
  const notices: TypingNotice[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'PUT') return;
    const match = /\/rooms\/([^/]+)\/typing\//.exec(request.url());
    if (!match?.[1]) return;
    const body = request.postDataJSON() as { typing?: boolean } | null;
    notices.push({ roomId: decodeURIComponent(match[1]), typing: body?.typing === true });
  });
  return notices;
};

const startedTyping = (notices: TypingNotice[], roomId: string, from = 0): number =>
  notices.slice(from).filter((notice) => notice.roomId === roomId && notice.typing).length;

const restoringDraftSendsNoTyping = async (page: Page, browserName: string) => {
  const user = await registerDisposableUser(`drt_${browserName}_${RUN}`, PASSWORD);
  const notesName = `Harbor notes ${browserName} ${RUN}`;
  const scheduleName = `Dock schedule ${browserName} ${RUN}`;
  const notes = await createRoom(HOMESERVER, user.accessToken, { name: notesName });
  const schedule = await createRoom(HOMESERVER, user.accessToken, { name: scheduleName });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  const notices = recordTypingNotices(page);

  await page.goto(`/home/${encodeURIComponent(notes)}`);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await composer.click();
  await page.keyboard.type(DRAFT);
  // Typing is announced, which shows the notices are seen.
  await expect.poll(() => startedTyping(notices, notes)).toBeGreaterThan(0);

  // To another room and back, in the app: the draft comes back without a key pressed.
  await page.getByRole('link', { name: new RegExp(scheduleName) }).click();
  await expect.poll(() => decodeURIComponent(page.url())).toContain(schedule);
  const beforeReturn = notices.length;
  await page.getByRole('link', { name: new RegExp(notesName) }).click();
  await expect(composer).toContainText(DRAFT);
  await page.waitForTimeout(QUIET_MS);
  expect(startedTyping(notices, notes, beforeReturn), 'typing after the draft came back').toBe(0);

  // A reload brings the draft back from storage, again without typing.
  const beforeReload = notices.length;
  await page.reload();
  await expect(composer).toContainText(DRAFT, { timeout: 60_000 });
  await page.waitForTimeout(QUIET_MS);
  expect(startedTyping(notices, notes, beforeReload), 'typing after a reload').toBe(0);

  // A click into the restored draft moves the cursor; it is not typing either.
  await composer.click();
  await page.waitForTimeout(QUIET_MS);
  expect(startedTyping(notices, notes, beforeReload), 'typing after a click').toBe(0);

  // The first key pressed is.
  await page.keyboard.type('!');
  await expect.poll(() => startedTyping(notices, notes, beforeReload)).toBe(1);
};

test('a restored draft announces no typing (Chromium)', async ({ page, browserName }) => {
  test.setTimeout(180_000);
  await restoringDraftSendsNoTyping(page, browserName);
});

test('a restored draft announces no typing (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    restoringDraftSendsNoTyping(page, 'webkit')
  );
});
