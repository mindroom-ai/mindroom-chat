import { writeFileSync } from 'node:fs';
import type { Browser, BrowserContextOptions, Page, Request, Response } from '@playwright/test';
import {
  expect,
  routeClientConfig,
  signIn,
  test,
  uniqueWord,
  type AgentStack,
} from '../helpers/agentStack';
import { createRoom } from '../helpers/createRoom';
import { matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (P2-lane2-F003): the person asks the helper, glances at the reply while it streams,
// and moves on. The server counts the finished reply as new (the finished-stream rule) and
// pushes it, but no device raised a desktop notification: the client had sent a receipt on the
// reply while it streamed, and the notifier took that receipt as reading the finished reply.
// The real MindRoom backend with the stub model (scripts/agent-stack/stack.py) streams five
// replies at once, one per room, each 400 words over about 100 seconds (`#stopme`), to four
// devices of the tester's account:
// - desk: glances at its reply, then moves to another room; also sits elsewhere while the reply
//   the phone glanced at and the reply nobody opened finish;
// - phone (390 by 844, touch): glances at its reply, then goes Home;
// - a desk that keeps its reply's thread open while its window has no focus;
// - a desk that watches its reply finish: it reads the reply and raises nothing.
// Each finished reply notifies once on every device that was not looking at it. Chromium and,
// when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit.
test.describe.configure({ timeout: 720_000 });

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
};
const FILLER_ROOMS = 20;
const QUIET_MESSAGE = 'The design review moved to Thursday afternoon.';
/** The start of every finished `#stopme` reply's notification: 400 words, word1 to word400. */
const REPLY_START = 'Helper: word1 word2 word3';

type Raw = { event_id: string; type: string; sender: string; content: Record<string, unknown> };
type Relation = { rel_type?: string; event_id?: string };
type Shown = { title: string; body?: string };
type SentReceipt = { eventId: string; threadId?: string; status?: number };
type Device = { name: string; page: Page; receipts: SentReceipt[] };
/** A room with an agent reply streaming in the thread of the tester's question. */
type Stream = { name: string; roomId: string; rootId: string; replyId: string };

const relationOf = (event: Raw): Relation | undefined =>
  event.content['m.relates_to'] as Relation | undefined;

/** The room's newest events as the server has them, newest first. */
const roomEvents = async (stack: AgentStack, roomId: string): Promise<Raw[]> =>
  (
    await matrixFetch<{ chunk: Raw[] }>(
      stack.homeserver,
      `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=60`,
      { accessToken: stack.tester.accessToken }
    )
  ).chunk;

/** A new room of the tester's with the helper and the router, once both joined it. */
const createAgentRoom = async (stack: AgentStack, name: string): Promise<string> => {
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(
    stack.homeserver,
    '/createRoom',
    {
      method: 'POST',
      accessToken: stack.tester.accessToken,
      body: JSON.stringify({
        name,
        preset: 'private_chat',
        invite: [stack.agents.helper, stack.agents.router],
      }),
    }
  );
  await expect
    .poll(
      async () => {
        const { joined } = await matrixFetch<{ joined: Record<string, unknown> }>(
          stack.homeserver,
          `/rooms/${encodeURIComponent(roomId)}/joined_members`,
          { accessToken: stack.tester.accessToken }
        );
        return !!joined[stack.agents.helper] && !!joined[stack.agents.router];
      },
      { timeout: 90_000, intervals: [500, 1000], message: `the agents join ${name}` }
    )
    .toBe(true);
  return roomId;
};

const createPlainRoom = (stack: AgentStack, name: string): Promise<string> =>
  createRoom(stack.homeserver, stack.tester.accessToken, { name });

/** Asks the helper in the room (a mention, as the composer sends it); its reply starts a thread. */
const askHelper = async (stack: AgentStack, name: string, roomId: string): Promise<Stream> => {
  const rootId = await sendRoomMessage(stack.homeserver, stack.tester.accessToken, roomId, {
    msgtype: 'm.text',
    body: `Helper #stopme what changed in ${name}?`,
    'm.mentions': { user_ids: [stack.agents.helper] },
  });
  let replyId: string | undefined;
  await expect
    .poll(
      async () => {
        replyId = (await roomEvents(stack, roomId)).find(
          (event) =>
            event.sender === stack.agents.helper &&
            event.type === 'm.room.message' &&
            relationOf(event)?.rel_type === 'm.thread' &&
            relationOf(event)?.event_id === rootId
        )?.event_id;
        return !!replyId;
      },
      { timeout: 120_000, intervals: [500, 1000], message: `the helper's reply in ${name}` }
    )
    .toBe(true);
  return { name, roomId, rootId, replyId: replyId! };
};

/** The reply's stream status after its newest edit, and that edit, as the server has them. */
const streamState = async (stack: AgentStack, stream: Stream) => {
  const events = await roomEvents(stack, stream.roomId);
  const edit = events.find((event) => {
    const relation = relationOf(event);
    return relation?.rel_type === 'm.replace' && relation.event_id === stream.replyId;
  });
  const content = edit
    ? (edit.content['m.new_content'] as Record<string, unknown> | undefined)
    : events.find((event) => event.event_id === stream.replyId)?.content;
  return { status: content?.['io.mindroom.stream_status'], editId: edit?.event_id };
};

/** The `Notification` API as a recorder: permission granted, each one kept on the window. */
const recordNotifications = (page: Page) =>
  page.addInitScript(() => {
    const shown: { title: string; body?: string }[] = [];
    (window as unknown as { shownNotifications: typeof shown }).shownNotifications = shown;
    class RecordingNotification {
      static permission = 'granted';

      static requestPermission = async () => 'granted';

      onclick: (() => void) | null = null;

      constructor(title: string, options: NotificationOptions = {}) {
        shown.push({ title, body: options.body });
      }

      close() {
        return undefined;
      }
    }
    Object.defineProperty(window, 'Notification', { value: RecordingNotification });
  });

/** The read receipts the page sends, each with the server's answer once it came. */
const recordReceipts = (page: Page): SentReceipt[] => {
  const sent: SentReceipt[] = [];
  const byRequest = new Map<Request, SentReceipt>();
  page.on('request', (request) => {
    const path = /\/receipt\/[^/]+\/([^/?]+)/.exec(request.url());
    if (request.method() !== 'POST' || !path) return;
    const { thread_id: threadId } = (request.postDataJSON() ?? {}) as { thread_id?: string };
    const receipt = { eventId: decodeURIComponent(path[1] ?? ''), threadId };
    sent.push(receipt);
    byRequest.set(request, receipt);
  });
  page.on('response', (response: Response) => {
    const receipt = byRequest.get(response.request());
    if (receipt) receipt.status = response.status();
  });
  return sent;
};

/** A new session of the tester's account in its own browser context: another device. */
const openDevice = async (
  browser: Browser,
  stack: AgentStack,
  baseURL: string | undefined,
  name: string,
  options: BrowserContextOptions
): Promise<Device> => {
  const context = await browser.newContext({ storageState: undefined, baseURL, ...options });
  const page = await context.newPage();
  await recordNotifications(page);
  const receipts = recordReceipts(page);
  await routeClientConfig(page, stack);
  await signIn(page, stack);
  return { name, page, receipts };
};

const navigate = (page: Page, route: string) =>
  page.evaluate((target) => {
    window.history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);

const roomRoute = (roomId: string) => `/home/${encodeURIComponent(roomId)}/`;
const threadRoute = (stream: Stream) =>
  `/home/${encodeURIComponent(stream.roomId)}?threadId=${encodeURIComponent(stream.rootId)}`;

const notificationsOf = async (device: Device): Promise<Shown[]> =>
  device.page.evaluate(() => [
    ...(window as unknown as { shownNotifications: Shown[] }).shownNotifications,
  ]);

/** How many notifications of the helper's finished reply in `stream`'s room the device raised. */
const replyNotifications = async (device: Device, stream: Stream): Promise<number> =>
  (await notificationsOf(device)).filter(
    (shown) => shown.title === stream.name && !!shown.body?.startsWith(REPLY_START)
  ).length;

/**
 * Opens the reply's thread while it streams, until the page sent its receipt on the reply (in
 * the thread, accepted by the server), and fails when the reply finished before that.
 */
const glance = async (device: Device, stack: AgentStack, stream: Stream) => {
  await navigate(device.page, threadRoute(stream));
  await expect(device.page.locator(`[data-message-id="${stream.replyId}"]`).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect
    .poll(
      () =>
        device.receipts.some(
          (receipt) =>
            receipt.eventId === stream.replyId &&
            receipt.threadId === stream.rootId &&
            receipt.status === 200
        ),
      { timeout: 30_000, message: `${device.name} reads the start of the reply in ${stream.name}` }
    )
    .toBe(true);
  const { status } = await streamState(stack, stream);
  expect(status, `the reply in ${stream.name} still streams after the glance`).not.toBe(
    'completed'
  );
};

/** Takes the window's focus away, as when the person switches to another application. */
const blurWindow = (page: Page) =>
  page.evaluate(() => {
    document.hasFocus = () => false;
    window.dispatchEvent(new Event('blur'));
  });

const waitForFinish = async (stack: AgentStack, stream: Stream): Promise<string> => {
  let editId: string | undefined;
  await expect
    .poll(
      async () => {
        const state = await streamState(stack, stream);
        editId = state.editId;
        return state.status;
      },
      { timeout: 300_000, intervals: [1000], message: `the reply in ${stream.name} finishes` }
    )
    .toBe('completed');
  return editId!;
};

const run = async (browser: Browser, stack: AgentStack, baseURL: string | undefined) => {
  const engine = browser.browserType().name();
  const tag = uniqueWord('');
  const log: string[] = [];
  const name = (label: string) => `${label} ${tag}`;
  const quietId = await createPlainRoom(stack, name('Quiet Corner'));
  await sendRoomMessage(stack.homeserver, stack.tester.accessToken, quietId, {
    msgtype: 'm.text',
    body: QUIET_MESSAGE,
  });
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createPlainRoom(stack, name(`Project room ${index}`));
  const labels = ['Release Desk', 'Phone Desk', 'Away Desk', 'Watch Desk', 'Control Desk'];
  const roomIds = await Promise.all(labels.map((label) => createAgentRoom(stack, name(label))));

  const devices = await Promise.all([
    openDevice(browser, stack, baseURL, 'desk', DESKTOP),
    openDevice(browser, stack, baseURL, 'phone', PHONE),
    openDevice(browser, stack, baseURL, 'unfocused desk', DESKTOP),
    openDevice(browser, stack, baseURL, 'watching desk', DESKTOP),
  ]);
  const [desk, phone, unfocused, watching] = devices;
  try {
    await navigate(desk.page, roomRoute(quietId));
    await expect(desk.page.getByText(QUIET_MESSAGE).last()).toBeVisible({ timeout: 60_000 });

    const streams = await Promise.all(
      labels.map((label, index) => askHelper(stack, name(label), roomIds[index]!))
    );
    const [glanced, phoneGlanced, away, watched, control] = streams as [
      Stream,
      Stream,
      Stream,
      Stream,
      Stream
    ];

    await Promise.all([
      // The desk glances at its reply, then moves to another room.
      (async () => {
        await glance(desk, stack, glanced);
        await navigate(desk.page, roomRoute(quietId));
        await expect(desk.page.getByText(QUIET_MESSAGE).last()).toBeVisible({ timeout: 30_000 });
      })(),
      // The phone glances at its reply, then goes Home.
      (async () => {
        await glance(phone, stack, phoneGlanced);
        await navigate(phone.page, '/home/');
        await expect(phone.page.locator('[data-thread-context-banner]')).toHaveCount(0, {
          timeout: 30_000,
        });
      })(),
      // A desk keeps its reply's thread open, and the person switches to another window.
      (async () => {
        await glance(unfocused, stack, away);
        await blurWindow(unfocused.page);
      })(),
      // A desk watches its reply to the end.
      glance(watching, stack, watched),
    ]);
    // Nothing notified while the replies streamed: not their placeholders, not their progress.
    for (const device of devices)
      for (const stream of streams)
        expect(await replyNotifications(device, stream), `${device.name}, ${stream.name}`).toBe(0);

    const finishIds = await Promise.all(streams.map((stream) => waitForFinish(stack, stream)));
    const watchedFinish = finishIds[3]!;
    // The watching desk reads the finished reply: a receipt on the edit that finished it.
    await expect
      .poll(
        () =>
          watching.receipts.some(
            (receipt) =>
              receipt.eventId === watchedFinish &&
              receipt.threadId === watched.rootId &&
              receipt.status === 200
          ),
        { timeout: 30_000, message: 'the watching desk reads the finished reply' }
      )
      .toBe(true);

    const expected: [Device, Stream, number][] = [
      [desk, glanced, 1],
      [desk, phoneGlanced, 1],
      [desk, control, 1],
      [phone, phoneGlanced, 1],
      [phone, control, 1],
      [unfocused, away, 1],
      [watching, watched, 0],
    ];
    const counts = async () =>
      Promise.all(
        expected.map(
          async ([device, stream]) =>
            `${device.name}, ${stream.name}: ${await replyNotifications(device, stream)}`
        )
      );
    const want = expected.map(
      ([device, stream, count]) => `${device.name}, ${stream.name}: ${count}`
    );
    // A notification follows the sync that brings the finishing edit; give each device time.
    await expect.poll(counts, { timeout: 60_000, intervals: [1000] }).toEqual(want);
    // No second notification comes later.
    await desk.page.waitForTimeout(5_000);
    expect(await counts()).toEqual(want);
  } finally {
    for (const device of devices) {
      log.push(`${device.name}: ${JSON.stringify(await notificationsOf(device).catch(() => []))}`);
      log.push(`${device.name} receipts: ${JSON.stringify(device.receipts)}`);
    }
    writeFileSync(test.info().outputPath(`notifications-${engine}.log`), `${log.join('\n')}\n`);
    await Promise.all(devices.map((device) => device.page.context().close()));
  }
};

test('a reply seen while it streamed notifies when it finishes (Chromium)', async ({
  browser,
  stack,
  baseURL,
}) => {
  await run(browser, stack, baseURL);
});

test('a reply seen while it streamed notifies when it finishes (WebKit)', async ({
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const webkit = await launchWebKit();
  try {
    await run(webkit, stack, baseURL);
  } finally {
    await webkit.close();
  }
});
