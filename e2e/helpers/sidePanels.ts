import { randomUUID } from 'node:crypto';
import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from './auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  registerDisposableUser,
  type DisposableUser,
} from './disposableAccounts';
import {
  createPrivateRoom,
  createThreadFixture,
  joinRoom,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
  type ThreadFixture,
} from './matrix';
import { roomHeader, roomMoreOptions } from './roomMenu';
import { alignUiActionSync } from './uiActionSync';

// A room with every core side panel (src/app/room/Room.tsx; their rule is
// src/app/ui/panels/roomPanels.ts) on the disposable homeserver: an agent that shows canvases, its computer (a service the page answers with an
// error, so the panel opens without a worker), and calls (a service the homeserver announces
// through the page, never reached: the call panel opens without a call).

export const CORE_PANELS = ['computer', 'canvas', 'call', 'members'] as const;
/** The name of the room the viewer opens the panels in. */
const PANEL_ROOM = 'Side panels';
type CorePanel = (typeof CORE_PANELS)[number];

const COMPUTER_API = 'http://127.0.0.1:28179';

export type PanelRoom = ThreadFixture & { viewer: DisposableUser; agent: MatrixSession };

/** A viewer, an agent and a thread of theirs in a new room. */
const seedPanelRoom = async (): Promise<PanelRoom> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const viewer = await registerDisposableUser(`panels_${suffix}`, randomUUID());
  const agent = await registerAgentAccount(HOMESERVER, 'panels');
  const fixture = await createThreadFixture(HOMESERVER, viewer.accessToken, {
    name: PANEL_ROOM,
    topic: 'One side panel at a time',
    rootBody: 'Show me around',
    replyBody: 'The panels of this conversation',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, fixture.roomId);
  return { ...fixture, viewer, agent };
};

/**
 * Seeds the room, serves its computer and call services and config.json with the computer,
 * canvases and the agent's live requests on, then signs the viewer in and opens the thread.
 */
export const openPanelRoom = async (context: BrowserContext, page: Page): Promise<PanelRoom> => {
  const room = await seedPanelRoom();
  await context.route(`${COMPUTER_API}/**`, (route) =>
    route.fulfill({ status: 400, json: { detail: 'Local fixture computer unavailable' } })
  );
  await context.route(
    `${HOMESERVER}/_matrix/client/unstable/org.matrix.msc4143/rtc/transports`,
    (route) =>
      route.fulfill({
        json: {
          rtc_transports: [{ type: 'livekit', livekit_service_url: 'http://127.0.0.1:9/livekit' }],
        },
      })
  );
  await alignUiActionSync(context, page, HOMESERVER);
  const agentServer = room.agent.userId.slice(room.agent.userId.indexOf(':') + 1);
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [HOMESERVER],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        mindroom: {
          ...config.mindroom,
          computers: { apiUrl: COMPUTER_API },
          uiActions: { autoOpenFromHomeservers: [agentServer] },
          canvas: { enabled: true },
        },
      },
    });
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...room.viewer });
  const liveSync = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith('/sync') && url.searchParams.get('timeout') === '30000';
  });
  await page.goto(
    `/home/${encodeURIComponent(room.roomId)}?threadId=${encodeURIComponent(room.rootId)}`
  );
  await expect(page.getByText(room.replyBody, { exact: true })).toBeVisible({ timeout: 60_000 });
  // An agent's request opens a panel only once sync delivers live.
  await liveSync;
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  return room;
};

export const panelLocator = (page: Page, panel: CorePanel | 'plugin'): Locator =>
  page.locator(`[data-testid="resizable-${panel}-panel"]`);

/** Opens a core panel as its users do, and waits until it shows. */
export const openPanel = async (page: Page, room: PanelRoom, panel: CorePanel) => {
  if (panel === 'computer') {
    const button = roomHeader(page).getByRole('button', { name: 'Show Computer', exact: true });
    if (await button.isVisible()) {
      await button.click();
    } else {
      await roomMoreOptions(page).click();
      await page.getByRole('menuitem', { name: 'Show Computer', exact: true }).click();
    }
  } else if (panel === 'canvas') {
    await sendRoomMessage(HOMESERVER, room.agent.accessToken, room.roomId, {
      msgtype: 'm.notice',
      body: 'Here is a canvas',
      'm.relates_to': { rel_type: 'm.thread', event_id: room.rootId },
      'io.mindroom.ui_action': {
        version: 1,
        action: 'show_canvas',
        requester_id: room.viewer.userId,
        agent_user_id: room.agent.userId,
        room_id: room.roomId,
        thread_id: room.rootId,
        canvas: { title: 'Choices', html: '<p>Pick one</p>' },
      },
    });
  } else if (panel === 'call') {
    await roomHeader(page).getByRole('button', { name: 'Start a call', exact: true }).click();
  } else {
    await roomHeader(page).getByRole('button', { name: 'Show Members', exact: true }).click();
  }
  await expect(panelLocator(page, panel)).toBeVisible({ timeout: 30_000 });
};

/** Closes a core panel that shows, from its own Close button (the members from the header's). */
export const closePanel = async (page: Page, panel: CorePanel) => {
  const names: Record<CorePanel, string> = {
    computer: 'Close computer',
    canvas: 'Close canvas',
    call: 'Close call',
    members: 'Hide Members',
  };
  const scope = panel === 'members' ? roomHeader(page) : panelLocator(page, panel);
  await scope.getByRole('button', { name: names[panel], exact: true }).click();
  await expect(panelLocator(page, panel)).toHaveCount(0);
};

export const widthOf = async (locator: Locator): Promise<number> =>
  (await locator.boundingBox())?.width ?? 0;

/**
 * Opens another room of the viewer, `name`, from the room list, and waits for its header. The row
 * is found by its name's own text, since a count it shows is part of the link's name.
 */
export const showRoom = async (page: Page, name: string) => {
  await page
    .getByRole('link')
    .filter({ has: page.getByText(name, { exact: true }) })
    .first()
    .click();
  await expect(roomHeader(page).getByRole('heading', { name, exact: true })).toBeVisible();
};

/**
 * Takes the shown side panel (`panel`, titled `label`) through its frame's layouts in the room
 * `room` opened: it fills the room in the conversation's place, comes back beside it, folds to a
 * tab at the room's edge beside the whole conversation, stays folded while another room, where it
 * is not open, shows, and comes back from its tab. Saves a screenshot of each layout under
 * `testInfo`'s output, named after `label`.
 */
export const checkPanelFrame = async (
  page: Page,
  testInfo: TestInfo,
  room: PanelRoom,
  { panel, label }: { panel: Locator; label: string }
) => {
  const shot = (layout: string) =>
    page.screenshot({ path: testInfo.outputPath(`${label}-${layout}.png`.replaceAll(' ', '-')) });
  const fill = panel.getByRole('button', { name: `Fill the room with ${label}`, exact: true });
  const fold = panel.getByRole('button', { name: `Fold ${label} to the edge`, exact: true });
  const tab = panel.getByRole('button', { name: `Unfold ${label}`, exact: true });
  const conversation = roomHeader(page);
  const otherRoom = `Elsewhere ${room.roomId.slice(1, 9)}`;
  await createPrivateRoom(HOMESERVER, room.viewer.accessToken, {
    name: otherRoom,
    topic: 'Another room',
  });

  await expect(fill).toHaveAttribute('aria-pressed', 'false');
  // The panel has moved in to its width.
  await panel.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished))
  );
  const besideWidth = await widthOf(panel);
  const conversationWidth = await widthOf(conversation);
  await shot('beside');

  await fill.click();
  await expect(conversation).toHaveCount(0);
  await expect(fill).toHaveAttribute('aria-pressed', 'true');
  expect(await widthOf(panel)).toBeGreaterThan(besideWidth + conversationWidth - 20);
  // The panel's own content ends where the panel does, its end edge (its Close) in view.
  const end = async (locator: Locator) => {
    const box = (await locator.boundingBox())!;
    return box.x + box.width;
  };
  expect(await end(panel.locator(':scope > :first-child > :last-child'))).toBeLessThanOrEqual(
    (await end(panel)) + 1
  );
  await shot('filled');
  await fill.click();
  await expect(conversation).toBeVisible();
  await expect.poll(() => widthOf(panel)).toBe(besideWidth);
  expect(await widthOf(conversation)).toBe(conversationWidth);

  await fold.click();
  await expect(tab).toBeVisible();
  await expect(tab).toHaveText(label);
  await expect(fill).toHaveCount(0);
  const tabWidth = await widthOf(panel);
  expect(tabWidth).toBeLessThan(60);
  // The conversation takes the room's width but for the tab.
  expect(await widthOf(conversation)).toBeGreaterThan(conversationWidth + besideWidth - 60);
  await shot('folded');

  // Another room shows without it; back in its room it is still folded.
  await showRoom(page, otherRoom);
  await expect(panel).toHaveCount(0);
  await showRoom(page, PANEL_ROOM);
  await expect(tab).toBeVisible();
  expect(await widthOf(panel)).toBe(tabWidth);

  await tab.click();
  await expect(fill).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => widthOf(panel)).toBe(besideWidth);
  await expect(conversation).toBeVisible();
};
