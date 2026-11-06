import { writeFile } from 'node:fs/promises';
import { chromium, expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';

const TITLE = 'Release checklist and launch dates';
const ANSWER =
  'The release checklist is ready. Review the dates, confirm the rollout window, and share the final plan.';
const REAL_SUMMARIES = process.env.SUMMARY_TITLES_REAL === '1';
let roomId: string;
let rootId: string;
let userId: string;
let titleEvent: Record<string, unknown>;
let replyEvent: Record<string, unknown>;

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const inThread = (value: unknown): boolean => {
  if (!record(value) || !record(value.content)) return false;
  const relation = value.content['m.relates_to'];
  return record(relation) && relation.event_id === rootId;
};

// A fresh device only knows the root and its bundle. Hold lazy history reads and keep direct
// thread events out of sync/messages, so passing cannot depend on receiving the title itself.
// A single thread event asked for by ID (an edit's target, say) is answered as not found. The
// context blocks service workers: in WebKit a page they control skips this route altogether.
const summariesOnly = async (page: Page) => {
  await page.route('**/_matrix/client/**', async (route) => {
    const url = new URL(route.request().url());
    if (
      route.request().method() !== 'GET' ||
      !/\/(sync|messages|threads|event|context|relations)(\/|$)/.test(url.pathname)
    ) {
      await route.continue();
      return;
    }
    if (url.pathname.includes(`/relations/${encodeURIComponent(rootId)}`)) return;
    // Shorten long polls so the next sync can confirm catch-up before screenshots.
    if (url.pathname.endsWith('/sync')) url.searchParams.set('timeout', '1000');
    const response = await route.fetch({ url: url.href, timeout: 60_000 });
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const data: unknown = await response.json();
    if (inThread(data) || (record(data) && inThread(data.event))) {
      await route.fulfill({
        status: 404,
        json: { errcode: 'M_NOT_FOUND', error: 'Event not found.' },
      });
      return;
    }
    const visit = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.filter((item: unknown) => !inThread(item)).map(visit);
      if (!record(value)) return value;
      if (value.event_id === rootId && record(value.unsigned)) {
        const relations = value.unsigned['m.relations'];
        if (record(relations) && record(relations['m.thread']) && !REAL_SUMMARIES) {
          relations['m.thread']['io.mindroom.title'] = titleEvent;
          relations['m.thread']['io.mindroom.latest_reply'] = replyEvent;
        }
        return value;
      }
      Object.keys(value).forEach((key) => {
        value[key] = visit(value[key]);
      });
      return value;
    };
    await route.fulfill({ response, json: visit(data) });
  });
};

test.beforeEach(async () => {
  const testInfo = test.info();
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  userId = session.userId;
  const helper = await registerAgentAccount(homeserver, 'summary');
  // The title comes from a member with default power who never replied: any sender may title.
  const titler = await registerAgentAccount(homeserver, 'titles');
  await matrixFetch(homeserver, `/profile/${encodeURIComponent(helper.userId)}/displayname`, {
    method: 'PUT',
    accessToken: helper.accessToken,
    body: JSON.stringify({ displayname: 'Helper' }),
  });
  for (let i = 1; i <= 25; i += 1) {
    await createPrivateRoom(homeserver, session.accessToken, {
      name: `Project ${String(i).padStart(2, '0')}`,
      topic: 'Test project discussion',
    });
  }
  roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: 'Release planning',
    topic: 'Checklist and launch preparation',
    invite: [helper.userId, titler.userId],
  });
  await joinRoom(homeserver, helper.accessToken, roomId);
  await joinRoom(homeserver, titler.accessToken, roomId);
  rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Please review the release plan and recommend the next steps for launch.',
  });
  const relation = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  };
  let replyId = await sendRoomMessage(homeserver, helper.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Preparing the release checklist...',
    'm.relates_to': relation,
    // An m.text with a marker is still a conversational reply, not a title.
    ...(testInfo.title.includes('marked')
      ? { 'io.mindroom.thread_summary': { version: 1, summary: 'Release draft' } }
      : {}),
  });
  const titleId = await sendRoomMessage(homeserver, titler.accessToken, roomId, {
    msgtype: 'm.notice',
    body: TITLE,
    'm.relates_to': relation,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: TITLE,
      generated_at: new Date().toISOString(),
      message_count: 1,
    },
  });
  if (testInfo.title.includes('continued')) {
    replyId = await sendRoomMessage(homeserver, helper.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Checking the final launch dates...',
      'm.relates_to': relation,
    });
  }
  await sendRoomMessage(homeserver, helper.accessToken, roomId, {
    msgtype: 'm.text',
    body: `* ${ANSWER}`,
    'm.new_content': { msgtype: 'm.text', body: ANSWER, 'm.relates_to': relation },
    'm.relates_to': { rel_type: 'm.replace', event_id: replyId },
  });
  const eventPath = (id: string) =>
    `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(id)}`;
  titleEvent = await matrixFetch(homeserver, eventPath(titleId), {
    accessToken: session.accessToken,
  });
  replyEvent = await matrixFetch(homeserver, eventPath(replyId), {
    accessToken: session.accessToken,
  });
  delete titleEvent.room_id;
  delete replyEvent.room_id;
  if (REAL_SUMMARIES) {
    const root = await matrixFetch<Record<string, any>>(homeserver, eventPath(rootId), {
      accessToken: session.accessToken,
    });
    expect(root.unsigned['m.relations']['m.thread']['io.mindroom.title'].event_id).toBe(titleId);
    expect(root.unsigned['m.relations']['m.thread']['io.mindroom.latest_reply'].event_id).toBe(
      replyId
    );
    // Written beside the screenshots: the unit fixtures in src/app/event-store/threads/fixtures/
    // are recorded from this file.
    const recorded = testInfo.outputPath('server-thread-summary.json');
    await writeFile(recorded, JSON.stringify(root, null, 2));
    await testInfo.attach('server-thread-summary.json', {
      path: recorded,
      contentType: 'application/json',
    });
  }
});

for (const engine of ['chromium', 'webkit'] as const) {
  for (const phone of [false, true]) {
    for (const order of ['title-last', 'continued', 'marked-reply'] as const) {
      test(`${engine} ${
        phone ? 'phone' : 'desktop'
      } ${order} fresh login shows bundled title and edited preview`, async ({
        baseURL,
      }, testInfo) => {
        test.setTimeout(180_000);
        test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'WebKit executable required');
        const ownBrowser =
          engine === 'webkit'
            ? await launchWebKit()
            : await chromium.launch({
                executablePath: process.env.CHROMIUM_PATH || undefined,
                ignoreDefaultArgs: ['--hide-scrollbars'],
              });
        const context = await ownBrowser.newContext({
          baseURL,
          viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
          hasTouch: phone,
          isMobile: phone,
          serviceWorkers: 'block',
        });
        const page = await context.newPage();
        try {
          await page.addInitScript(() => {
            if (!localStorage.getItem('settings'))
              localStorage.setItem(
                'settings',
                JSON.stringify({
                  useSystemTheme: false,
                  themeId: 'light-theme',
                  isPeopleDrawer: false,
                })
              );
          });
          await summariesOnly(page);
          await loginWithPassword(page, {
            homeserver: getHomeserver(),
            ...getPrimaryCredentials(),
          });
          await seedRoomOverviewState({
            page,
            roomId,
            userId,
            viewMode: 'compact',
            filterState: createDefaultThreadFilterState(),
          });
          await page.goto(`/home/${encodeURIComponent(roomId)}`);
          const card = page.locator(`button[data-thread-root-id="${rootId}"]`).first();
          await expect(card).toBeVisible({ timeout: 30_000 });
          await expect(page.getByText('Catching up...', { exact: true })).toHaveCount(0);
          // The same capture point on the failing baseline and fixed build.
          await page.screenshot({ path: testInfo.outputPath('compact-light.png') });
          await expect(card).toContainText(TITLE);
          await expect(card).toContainText('Helper: The release checklist is ready.');
          await pressPaletteShortcut(page);
          const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
          await palette.getByRole('tab', { name: 'Threads', exact: true }).click();
          await palette.getByRole('combobox').fill(TITLE);
          await expect(
            palette.locator(`[data-kind="thread"][data-item-id$="${rootId}"]`)
          ).toContainText(TITLE);
          await page.keyboard.press('Escape');
          await page.reload();
          await expect(card).toContainText(TITLE);
          await expect(card).toContainText('Helper: The release checklist is ready.');
          await card.click();
          await expect(page.locator('[data-thread-context-summary="true"]').first()).toContainText(
            TITLE
          );
          await page.screenshot({ path: testInfo.outputPath('header-light.png') });
          await seedRoomOverviewState({
            page,
            roomId,
            userId,
            viewMode: 'threaded',
            filterState: createDefaultThreadFilterState(),
          });
          await page.goto(`/home/${encodeURIComponent(roomId)}`);
          await expect(page.getByRole('group').filter({ hasText: TITLE }).first()).toBeVisible();
          await page.screenshot({ path: testInfo.outputPath('threads-light.png') });
          await page.evaluate(() => {
            const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
            localStorage.setItem(
              'settings',
              JSON.stringify({ ...settings, themeId: 'dark-theme' })
            );
          });
          await seedRoomOverviewState({
            page,
            roomId,
            userId,
            viewMode: 'compact',
            filterState: createDefaultThreadFilterState(),
          });
          await page.reload();
          await expect(card).toContainText(TITLE);
          await expect(card).toContainText('Helper: The release checklist is ready.');
          await page.screenshot({ path: testInfo.outputPath('compact-dark.png') });
        } finally {
          await page.unrouteAll({ behavior: 'ignoreErrors' });
          await context.close();
          await ownBrowser.close();
        }
      });
    }
  }
}
