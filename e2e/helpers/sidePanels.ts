import { randomUUID } from 'node:crypto';
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from './auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  registerDisposableUser,
  type DisposableUser,
} from './disposableAccounts';
import {
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
type CorePanel = (typeof CORE_PANELS)[number];

const COMPUTER_API = 'http://127.0.0.1:28179';

export type PanelRoom = ThreadFixture & { viewer: DisposableUser; agent: MatrixSession };

/** A viewer, an agent and a thread of theirs in a new room. */
const seedPanelRoom = async (): Promise<PanelRoom> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const viewer = await registerDisposableUser(`panels_${suffix}`, randomUUID());
  const agent = await registerAgentAccount(HOMESERVER, 'panels');
  const fixture = await createThreadFixture(HOMESERVER, viewer.accessToken, {
    name: 'Side panels',
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
