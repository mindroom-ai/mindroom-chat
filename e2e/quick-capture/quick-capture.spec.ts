import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom, matrixFetch } from '../helpers/matrix';

// The quick capture widget (/quick-capture/) against the signed-in app in the same browser, on
// the disposable homeserver. The widget runs no Matrix client: the app page serves it over a
// BroadcastChannel (src/app/quick-capture/QuickCaptureHost.tsx). The widget's room picker lists
// the account's rooms and keeps the one picked across a reload; Enter posts an entry as a new
// thread, which the widget lists and the app shows; a pasted image with text gives a thread whose
// root is the image and whose reply is the text; x resolves a thread nobody answered, which stays
// in the widget dimmed and sets the room's resolved tag; Control+Enter posts and opens the thread
// in the app page. Nobody answers in these rooms.

const WIDGET_VIEWPORT = { width: 360, height: 460 };

type RoomEvent = {
  event_id: string;
  type: string;
  sender: string;
  state_key?: string;
  content: {
    msgtype?: string;
    body?: string;
    set_by?: string;
    'm.relates_to'?: { rel_type?: string; event_id?: string };
  };
};

/** The room's newest messages, newest first, read with the user's access token. */
const roomMessages = async (accessToken: string, roomId: string): Promise<RoomEvent[]> =>
  (
    await matrixFetch<{ chunk: RoomEvent[] }>(
      HOMESERVER,
      `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=50`,
      { accessToken }
    )
  ).chunk.filter((event) => event.type === 'm.room.message');

/** The ID of the room's message with `body`, once the homeserver has it. */
const messageIdWithBody = async (
  accessToken: string,
  roomId: string,
  body: string
): Promise<string> => {
  let eventId: string | undefined;
  await expect
    .poll(async () => {
      eventId = (await roomMessages(accessToken, roomId)).find(
        (event) => event.content.body === body
      )?.event_id;
      return eventId;
    }, `a message "${body}"`)
    .toBeDefined();
  return eventId ?? '';
};

/** Pastes a PNG the page draws (8 by 8 pixels) into the focused element, as from the clipboard. */
const pastePng = (widget: Page, name: string) =>
  widget.evaluate(async (fileName) => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2D canvas');
    context.fillStyle = '#3a7bd5';
    context.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png');
    });
    if (!blob) throw new Error('The canvas gave no PNG');
    const data = new DataTransfer();
    data.items.add(new File([blob], fileName, { type: 'image/png' }));
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    );
  }, name);

test('quick capture posts into the signed-in app', async ({ page }) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(3 * 60_000);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const user = await registerDisposableUser(`quickcapture_${suffix}`, randomUUID());
  const inboxId = await createPrivateRoom(HOMESERVER, user.accessToken, {
    name: 'Inbox',
    topic: 'Where quick captures go',
  });
  await createPrivateRoom(HOMESERVER, user.accessToken, { name: 'Other', topic: 'Another room' });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await page.goto(`/home/${encodeURIComponent(inboxId)}/`);

  const widget = await page.context().newPage();
  await widget.setViewportSize(WIDGET_VIEWPORT);
  await widget.goto('/quick-capture/');
  const input = widget.getByRole('textbox', { name: 'New entry', exact: true });
  const roomButton = widget.getByRole('button', {
    name: 'Posting to Inbox. Change room',
    exact: true,
  });
  const list = widget.getByRole('list', { name: 'Threads in Inbox', exact: true });

  // With no room stored, the picker opens on the account's rooms. Picking Inbox names it in the
  // header, and a reload of the widget keeps it.
  await expect(widget.getByRole('combobox', { name: 'Search rooms', exact: true })).toBeVisible({
    timeout: 60_000,
  });
  // An option's name starts with its sigil, "#" for a room.
  const rooms = widget.getByRole('listbox', { name: 'Choose a room', exact: true });
  await expect(rooms.getByRole('option', { name: 'Other' })).toBeVisible();
  await rooms.getByRole('option', { name: 'Inbox' }).click();
  await expect(roomButton).toBeVisible();
  await widget.reload();
  await expect(roomButton).toBeVisible({ timeout: 30_000 });
  await expect(widget.getByText('Nothing open here', { exact: true })).toBeVisible();

  // Enter posts the entry: a row in the widget, a message in Inbox on the app page.
  await input.fill('Buy oat milk');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  const milkRow = list.getByRole('button', { name: /Buy oat milk/ });
  await expect(milkRow).toBeVisible();
  await expect(
    page.getByRole('main').getByText('Buy oat milk', { exact: true }).first()
  ).toBeVisible();
  const milkId = await messageIdWithBody(user.accessToken, inboxId, 'Buy oat milk');

  // A pasted image with text: the image is the thread's root and the text its reply.
  await input.fill('What is this?');
  await pastePng(widget, 'capture.png');
  await expect(
    widget.getByRole('button', { name: 'Remove capture.png', exact: true })
  ).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect
    .poll(async () => {
      const messages = await roomMessages(user.accessToken, inboxId);
      const reply = messages.find((event) => event.content.body === 'What is this?');
      const relation = reply?.content['m.relates_to'];
      const root = messages.find((event) => event.event_id === relation?.event_id);
      return { relation: relation?.rel_type, root: root?.content.msgtype };
    }, 'the image thread')
    .toEqual({ relation: 'm.thread', root: 'm.image' });

  // x on the row of the root nobody answered resolves it: it stays in the widget, dimmed, at the
  // end of the list, and the room's state holds the tag.
  await milkRow.focus();
  await widget.keyboard.press('x');
  await expect(
    list.getByRole('listitem').filter({ hasText: 'Buy oat milk' }).getByRole('button', {
      name: 'Reopen',
      exact: true,
    })
  ).toBeVisible();
  await expect(milkRow).toHaveCSS('opacity', '0.6');
  await expect(list.getByRole('listitem').last()).toContainText('Buy oat milk');
  await expect
    .poll(async () => {
      const state = await matrixFetch<RoomEvent[]>(
        HOMESERVER,
        `/rooms/${encodeURIComponent(inboxId)}/state`,
        { accessToken: user.accessToken }
      );
      return state.find(
        (event) =>
          event.type === 'com.mindroom.thread.tags' &&
          event.state_key === JSON.stringify([milkId, 'resolved'])
      )?.content.set_by;
    }, 'the resolved tag')
    .toBe(user.userId);

  // Control+Enter posts the entry and opens its thread in the app page.
  await input.fill('Call the dentist');
  await input.press('Control+Enter');
  await expect(input).toHaveValue('');
  const dentistId = await messageIdWithBody(user.accessToken, inboxId, 'Call the dentist');
  await expect
    .poll(() => new URL(page.url()).searchParams.get('threadId'), 'the thread in the app page')
    .toBe(dentistId);
});
