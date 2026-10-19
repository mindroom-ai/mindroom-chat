import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createThreadFixture,
  loginToMatrix,
  matrixFetch,
  type MatrixSession,
  seedRoomOverviewState,
  setAccountData,
} from '../helpers/matrix';

test.use({ viewport: { width: 1100, height: 900 } });
test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');

type RoomMessages = {
  chunk: { event_id: string; sender: string; content: Record<string, unknown> }[];
};

// About 22 KB of Markdown: short enough that the composer keeps the paste inline, but its HTML
// makes the message larger than one Matrix event can hold.
const LINE_COUNT = 300;
const message = Array.from({ length: LINE_COUNT }, (_, index) => {
  const n = index + 1;
  return `- **Point ${n}**: see \`item_${n}()\`, _note_ and [link](https://example.org/${n})`;
}).join('\n');

// One API session for both cases: the homeserver rate-limits logins.
let session: MatrixSession;
test.beforeAll(async () => {
  const credentials = getPrimaryCredentials();
  session = await loginToMatrix(getHomeserver(), credentials.username, credentials.password);
  await setAccountData(
    getHomeserver(),
    session.accessToken,
    session.userId,
    'io.mindroom.settings',
    {
      simpleMode: false,
    }
  );
});

for (const surface of ['room', 'thread'] as const) {
  test(`${surface}: a pasted message too large for one event is sent whole`, async ({ page }) => {
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const fixture = await createThreadFixture(homeserver, session.accessToken, {
      name: `Long composer message ${surface} ${Date.now()}`,
      topic: 'Local long composer message check',
      rootBody: 'Long composer message',
      replyBody: 'Short reply.',
    });

    await loginWithPassword(page, { homeserver, ...credentials });
    await seedRoomOverviewState({
      page,
      roomId: fixture.roomId,
      userId: session.userId,
      viewMode: surface === 'room' ? 'classic' : 'threaded',
    });
    const roomPath = `/home/${encodeURIComponent(fixture.roomId)}`;
    await page.goto(
      surface === 'room' ? roomPath : `${roomPath}?threadId=${encodeURIComponent(fixture.rootId)}`
    );
    const timeline = surface === 'thread' ? page.locator('div[data-thread-count]') : page;
    await expect(timeline.getByText('Short reply.')).toBeVisible();

    const composer = page.getByRole('textbox').first();
    await composer.click();
    await composer.evaluate((editor, text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      editor.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
      );
    }, message);
    await expect(composer).toContainText(`Point ${LINE_COUNT}`);
    await page.getByRole('button', { name: 'Send message' }).click();

    // The message is confirmed by the server, and its full text replaces the preview.
    const ownRow = timeline.locator('[data-message-id^="$"]').filter({ hasText: 'Point 1:' });
    await expect(ownRow).toContainText(`item_${LINE_COUNT}()`);
    await expect(composer).not.toContainText('Point 1');

    // The server holds a preview that points at the file with the whole message.
    const { chunk } = await matrixFetch<RoomMessages>(
      homeserver,
      `/rooms/${encodeURIComponent(fixture.roomId)}/messages?dir=b&limit=10`,
      { accessToken: session.accessToken }
    );
    const sent = chunk.find(
      (event) => event.sender === session.userId && event.content.msgtype === 'm.file'
    );
    expect(sent?.content).toMatchObject({
      'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
      ...(surface === 'thread'
        ? { 'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId } }
        : {}),
    });
  });
}
