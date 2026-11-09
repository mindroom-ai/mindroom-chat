import type { Request } from '@playwright/test';
import { expect, openLobby, routeClientConfig, test } from '../helpers/agentStack';
import { roomHeader, roomMoreOptions } from '../helpers/roomMenu';

// The client SDK's `useRoomComputers` end to end: a production build with the example client plugin
// (src/app/plugins/__fixtures__/example-plugin) against the agent stack with --computers, whose
// helper has a Worker Computer in a Docker worker and publishes its server with a computer, while
// the router and the scout publish theirs without one. The example's panel in the lobby lists the
// helper alone, opens a session on its computer (a cold worker takes minutes to start), takes and
// releases control and ends the session on the server. The room's own computer button then opens
// the computer panel for the same agent.
//   MINDROOM_CLIENT_PLUGINS=$PWD/src/app/plugins/__fixtures__/example-plugin \
//     scripts/e2e-slot.sh <slot> --preview npx playwright test e2e/plugins/room-computers.spec.ts
test.skip(
  !process.env.MINDROOM_CLIENT_PLUGINS?.includes('example-plugin'),
  'needs a build with the example client plugin in MINDROOM_CLIENT_PLUGINS'
);

test.use({ agentStackArgs: ['--computers'] });
test.describe.configure({ timeout: 900_000 });

test("a plugin's panel lists the room's agents with a computer, and opens, controls and ends a session on one", async ({
  page,
  stack,
}) => {
  await routeClientConfig(page, stack);
  const created: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === `${stack.apiUrl}/api/computers/sessions`)
      created.push(request);
  });
  const panel = page.getByRole('region', { name: 'Example panel', exact: true });
  await openLobby(page, stack);
  await roomHeader(page).getByRole('button', { name: 'Example panel', exact: true }).click();
  await expect(panel.getByText('Agents with a computer: Helper', { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  const opened = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url() === `${stack.apiUrl}/api/computers/sessions`,
    { timeout: 600_000 }
  );
  await panel.getByRole('button', { name: 'Open computer of Helper', exact: true }).click();
  await expect(panel.getByText('Computer session: starting', { exact: true })).toBeVisible();
  const session = (await (await opened).json()) as { session_id: string; session_token: string };
  await expect(panel.getByText('Computer session: ready, view', { exact: true })).toBeVisible();
  expect(created[0].postDataJSON()).toMatchObject({
    room_id: stack.rooms.lobby,
    agent_user_id: stack.agents.helper,
  });

  await panel.getByRole('button', { name: 'Take computer control', exact: true }).click();
  await expect(panel.getByText('Computer session: ready, control', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await panel.getByRole('button', { name: 'Release computer control', exact: true }).click();
  await expect(panel.getByText('Computer session: ready, view', { exact: true })).toBeVisible();

  // Ended on the server: its token no longer reads the session.
  const ended = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      response.url() === `${stack.apiUrl}/api/computers/sessions/${session.session_id}`
  );
  await panel.getByRole('button', { name: 'End computer session', exact: true }).click();
  await expect(panel.getByText('Computer session: ended', { exact: true })).toBeVisible();
  expect((await ended).status()).toBe(204);
  const after = await fetch(`${stack.apiUrl}/api/computers/sessions/${session.session_id}`, {
    headers: { Authorization: `Bearer ${session.session_token}` },
  });
  expect([401, 404]).toContain(after.status);

  // The room's own computer button still finds the same agent.
  await roomMoreOptions(page).click();
  await page.getByRole('button', { name: 'Show Computer', exact: true }).click();
  const computerPanel = page.getByRole('complementary', { name: 'Computer panel' });
  await expect(computerPanel.getByText('Watch mode', { exact: true })).toBeVisible({
    timeout: 300_000,
  });
  expect(created).toHaveLength(2);
  expect(created[1].postDataJSON()).toMatchObject({
    room_id: stack.rooms.lobby,
    agent_user_id: stack.agents.helper,
  });
});
