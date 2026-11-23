import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  joinRoom,
  loginToMatrix,
  matrixFetch,
} from '../helpers/matrix';

/**
 * Multi-surface live verification: InviteUserPrompt opens cleanly as an inline
 * directory sheet on every host surface (no clipped pop-out menu), and ISSUE-216
 * ranking surfaces the intended agent for its short name.
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const SHOT_DIR = 'ui-audit/issue217';
const AGENT_SHORT_NAMES = [
  'mind',
  'sarro',
  'alpha',
  'beta',
  'gamma',
  'delta',
  'epsilon',
  'zeta',
  'eta',
  'theta',
  'iota',
  'kappa',
] as const;

type TestAccount = {
  accessToken: string;
  userId: string;
};

type PortalFixture = {
  roomName: string;
  spaceName: string;
  spaceId: string;
  childName: string;
  runId: string;
  mindUserId: string;
};

const createTestAccount = async (
  homeserver: string,
  username: string,
  displayName: string
): Promise<TestAccount> => {
  const password = randomUUID();
  const account = await matrixFetch<{ access_token: string; user_id: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({
        username,
        password,
        auth: { type: 'm.login.dummy' },
      }),
    }
  );

  await matrixFetch<unknown>(
    homeserver,
    `/profile/${encodeURIComponent(account.user_id)}/displayname`,
    {
      method: 'PUT',
      accessToken: account.access_token,
      body: JSON.stringify({ displayname: displayName }),
    }
  );

  return { accessToken: account.access_token, userId: account.user_id };
};

const seedPortalFixture = async (
  homeserver: string,
  viewer: TestAccount
): Promise<PortalFixture> => {
  const runId = randomUUID().replaceAll('-', '').slice(0, 12);
  const agents = await Promise.all(
    AGENT_SHORT_NAMES.map(async (shortName) => ({
      shortName,
      account: await createTestAccount(
        homeserver,
        `mindroom_${shortName}_${runId}`,
        shortName === 'mind'
          ? 'Mind'
          : `${shortName[0]!.toUpperCase() + shortName.slice(1)} ${runId}`
      ),
    }))
  );
  const agentHubId = await createPrivateRoom(homeserver, viewer.accessToken, {
    name: `Portal agent directory ${runId}`,
    topic: 'Directory fixture for invite coverage.',
    invite: agents.map((agent) => agent.account.userId),
  });
  await Promise.all(
    agents.map((agent) => joinRoom(homeserver, agent.account.accessToken, agentHubId))
  );

  const roomName = `Portal Test Room ${runId}`;
  const spaceName = `Portal Test Space ${runId}`;
  const childName = `Space Child Room ${runId}`;
  await createPrivateRoom(homeserver, viewer.accessToken, {
    name: roomName,
    topic: 'Invite directory fixture.',
  });
  const spaceId = await createPrivateSpace(homeserver, viewer.accessToken, {
    name: spaceName,
    topic: 'Invite directory hierarchy fixture.',
  });
  const childId = await createPrivateRoom(homeserver, viewer.accessToken, {
    name: childName,
    topic: 'Child room for invite directory coverage.',
  });
  await addRoomToSpace(homeserver, viewer.accessToken, spaceId, childId);

  const mindUserId = agents.find((agent) => agent.shortName === 'mind')!.account.userId;
  return { roomName, spaceName, spaceId, childName, runId, mindUserId };
};

async function verifyInviteDirectorySheet(page: Page, surface: string, mindUserId: string) {
  const dialog = page.getByRole('dialog', { name: /^Invite/ });
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  const field = dialog.getByRole('searchbox');
  await expect(field).toBeVisible();
  await field.fill('mind');

  const rows = dialog.locator('li');
  await expect.poll(() => rows.count(), { timeout: 15_000 }).toBeGreaterThan(1);

  // ISSUE-216: an exact display-name identity ranks before the generated shared-prefix fleet.
  const firstRow = rows.first();
  await expect(firstRow).toContainText('Mind');
  await expect(firstRow).toContainText(mindUserId);

  // Dialog stays cleanly within the viewport without a portaled floating listbox.
  const dialogBox = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(dialogBox, 'dialog bounding box').not.toBeNull();
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
  await expect(page.getByRole('listbox')).toHaveCount(0);

  await page.screenshot({ path: `${SHOT_DIR}/${surface}.png` });

  // Backdrop click dismisses the dialog cleanly.
  await page.mouse.click(viewport!.width - 8, viewport!.height - 8);
  await expect(dialog).toBeHidden();
}

test.describe('Invite directory sheet surfaces', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test('opens cleanly and ranks matches on each invite surface', async ({ page }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const viewer = await loginToMatrix(homeserver, username, password);
    const fixture = await seedPortalFixture(homeserver, viewer);

    await page.route('**/user_directory/search', (route) =>
      route.continue({
        postData: JSON.stringify({ ...route.request().postDataJSON(), search_term: fixture.runId }),
      })
    );

    await loginWithPassword(page, { homeserver, username, password });

    const roomLink = page.locator(`a[href^="/home/"]:has-text("${fixture.roomName}")`).first();
    await expect(roomLink).toBeVisible({ timeout: 30_000 });

    await test.step('room-nav-item context menu', async () => {
      await roomLink.click({ button: 'right' });
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyInviteDirectorySheet(page, 'room-nav-item', fixture.mindUserId);
    });

    await test.step('members drawer invite entry', async () => {
      await roomLink.click();
      const drawerInvite = page.locator('[aria-label="Invite people"]');
      await expect(drawerInvite).toBeVisible({ timeout: 30_000 });
      await drawerInvite.click();
      await verifyInviteDirectorySheet(page, 'members-drawer', fixture.mindUserId);
    });

    await test.step('mindroom room header menu', async () => {
      const roomHeader = page.locator(`header:has-text("${fixture.roomName}")`).first();
      await roomHeader.locator('button').last().click();
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyInviteDirectorySheet(page, 'mindroom-room-header', fixture.mindUserId);
    });

    await test.step('space tabs context menu', async () => {
      const spaceTab = page.locator(`button[data-id="${fixture.spaceId}"]`).first();
      await expect(spaceTab).toBeVisible({ timeout: 30_000 });
      await spaceTab.click({ button: 'right' });
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyInviteDirectorySheet(page, 'space-tabs', fixture.mindUserId);
    });

    await test.step('space page panel menu', async () => {
      const spaceTab = page.locator(`button[data-id="${fixture.spaceId}"]`).first();
      await spaceTab.click();
      const panelHeader = page.locator(`header:has-text("${fixture.spaceName}")`).last();
      await expect(panelHeader).toBeVisible({ timeout: 30_000 });
      await panelHeader.locator('button').last().click();
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyInviteDirectorySheet(page, 'space-page-menu', fixture.mindUserId);
    });

    await test.step('lobby header menu', async () => {
      await page.getByRole('link', { name: 'Space overview', exact: true }).click();
      const lobbyMembers = page.getByRole('button', { name: /Members/ });
      await expect(lobbyMembers).toBeVisible();
      const lobbyHeader = lobbyMembers.locator('xpath=ancestor::header[1]');
      await lobbyHeader.locator('button').last().click();
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyInviteDirectorySheet(page, 'lobby-header', fixture.mindUserId);
    });

    await test.step('hierarchy item menu', async () => {
      const childRow = page.getByText(fixture.childName).first();
      await expect(childRow).toBeVisible({ timeout: 30_000 });
      await childRow.hover();
      const rowOptions = childRow
        .locator('xpath=ancestor::*[.//button[@aria-pressed]][1]//button[@aria-pressed]')
        .last();
      await rowOptions.click();
      await page.getByText('Invite', { exact: true }).first().click();
      await verifyInviteDirectorySheet(page, 'hierarchy-item', fixture.mindUserId);
    });
  });
});
