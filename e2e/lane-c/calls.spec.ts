import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { buildLoginPath } from '../env';

// Calls over MatrixRTC and LiveKit between real browser sessions with fake microphones and
// cameras: a direct chat call that rings, is answered, carries sound both ways (encrypted too),
// mutes and shows video; and a call to a MindRoom agent, which runs in the agent call room with
// the conversation as its origin. Needs the slot's LiveKit server and authorization service:
//   eval "$(scripts/e2e-rtc.sh <slot> env)"; scripts/e2e-slot.sh <slot> down
//   scripts/e2e-rtc.sh <slot> up; scripts/e2e-slot.sh <slot> npx playwright test e2e/lane-c/calls.spec.ts
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'calls-spec-password';
const RUN = Date.now().toString(36);

test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--disable-features=IsolateSandboxedIframes',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

type Session = { userId: string; token: string };

const matrix = async <T>(
  path: string,
  init: { token?: string; body?: unknown; method?: string } = {}
): Promise<T> => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  expect(response.ok, `${path} answered ${response.status}`).toBe(true);
  return (await response.json()) as T;
};

const register = async (username: string, displayName: string): Promise<Session> => {
  const { access_token: token, user_id: userId } = await matrix<{
    access_token: string;
    user_id: string;
  }>('/register', {
    body: { username, password: PASSWORD, auth: { type: 'm.login.dummy' } },
  });
  await matrix(`/profile/${encodeURIComponent(userId)}/displayname`, {
    token,
    method: 'PUT',
    body: { displayname: displayName },
  });
  return { userId, token };
};

const callServiceIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/.well-known/matrix/client`, {
      signal: AbortSignal.timeout(2_000),
    });
    const body = (await response.json()) as Record<string, unknown>;
    const foci = body['org.matrix.msc4143.rtc_foci'] as { livekit_service_url?: string }[];
    const url = foci?.[0]?.livekit_service_url;
    if (!url) return false;
    return (await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(2_000) })).ok;
  } catch {
    return false;
  }
};

/** A direct chat between two people, both with full power, as this client creates them. */
const createDirectChat = async (owner: Session, guest: Session, encrypted: boolean) => {
  const { room_id: roomId } = await matrix<{ room_id: string }>('/createRoom', {
    token: owner.token,
    body: {
      preset: 'trusted_private_chat',
      is_direct: true,
      invite: [guest.userId],
      initial_state: encrypted
        ? [
            {
              type: 'm.room.encryption',
              state_key: '',
              content: { algorithm: 'm.megolm.v1.aes-sha2' },
            },
          ]
        : [],
    },
  });
  await matrix(`/join/${encodeURIComponent(roomId)}`, { token: guest.token, body: {} });
  for (const [me, other] of [
    [owner, guest],
    [guest, owner],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await matrix(`/user/${encodeURIComponent(me.userId)}/account_data/m.direct`, {
      token: me.token,
      method: 'PUT',
      body: { [other.userId]: [roomId] },
    });
  }
  return roomId;
};

const signIn = async (browser: Browser, username: string): Promise<Page> => {
  const context = await browser.newContext({ permissions: ['microphone', 'camera'] });
  const page = await context.newPage();
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 90_000 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return page;
};

const openRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(
    page.locator('[data-room-call-button], [data-agent-call-button]').first()
  ).toBeVisible({
    timeout: 60_000,
  });
};

const callPanel = (page: Page) => page.getByTestId('call-panel');
const tileOf = (page: Page, userId: string) => page.locator(`[data-call-tile="${userId}"]`);

/**
 * The loudest level of the other people's sound this page plays, sampled for a moment. Silence
 * (or undecryptable frames) stays near 0; the fake microphone's beeps reach well above it.
 */
const remoteSoundLevel = (page: Page) =>
  page.evaluate(async () => {
    const elements = [...document.querySelectorAll<HTMLAudioElement>('[data-call-audio] audio')];
    const streams = elements
      .map((element) => element.srcObject)
      .filter((stream): stream is MediaStream => stream instanceof MediaStream);
    if (streams.length === 0) return 0;
    const context = new AudioContext();
    await context.resume();
    const analysers = streams.map((stream) => {
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      return analyser;
    });
    const samples = new Float32Array(2048);
    let loudest = 0;
    const until = performance.now() + 3000;
    while (performance.now() < until) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      analysers.forEach((analyser) => {
        analyser.getFloatTimeDomainData(samples);
        samples.forEach((value) => {
          loudest = Math.max(loudest, Math.abs(value));
        });
      });
    }
    await context.close();
    return loudest;
  });

test.describe('calls', () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeEach(async () => {
    test.skip(!(await callServiceIsUp()), 'needs scripts/e2e-rtc.sh and its homeserver setting');
  });

  for (const encrypted of [false, true]) {
    test(`a direct chat call rings, connects and carries sound both ways${
      encrypted ? ' in an encrypted room' : ''
    }`, async ({ browser }) => {
      const suffix = `${RUN}${encrypted ? 'e' : 'p'}`;
      const alice = await register(`alice${suffix}`, 'Alice Call');
      const bob = await register(`bob${suffix}`, 'Bob Call');
      const roomId = await createDirectChat(alice, bob, encrypted);

      const alicePage = await signIn(browser, `alice${suffix}`);
      const bobPage = await signIn(browser, `bob${suffix}`);
      await openRoom(alicePage, roomId);
      await bobPage.goto('/home/');

      // Alice opens the call panel and joins: the empty call rings Bob.
      await alicePage.locator('[data-room-call-button]').click();
      await expect(callPanel(alicePage)).toBeVisible();
      await expect(callPanel(alicePage)).toContainText('Be the first to hop in');
      await callPanel(alicePage).getByRole('button', { name: 'Join', exact: true }).click();
      await expect(tileOf(alicePage, alice.userId)).toHaveAttribute('data-connected', 'true', {
        timeout: 60_000,
      });
      await expect(alicePage.locator('[data-call-tab]')).toBeVisible();

      const ring = bobPage.getByRole('alertdialog', { name: 'Incoming Call' });
      await expect(ring).toBeVisible({ timeout: 60_000 });
      await expect(ring).toContainText('Alice Call is calling');
      await ring.getByRole('button', { name: 'Answer' }).click();

      // Both see both, connected, and hear each other.
      for (const page of [alicePage, bobPage]) {
        // eslint-disable-next-line no-await-in-loop
        await expect(callPanel(page).locator('[data-call-tile]')).toHaveCount(2, {
          timeout: 60_000,
        });
        // eslint-disable-next-line no-await-in-loop
        await expect(
          callPanel(page).locator('[data-call-tile][data-connected="true"]')
        ).toHaveCount(2, { timeout: 60_000 });
      }
      await expect.poll(() => remoteSoundLevel(bobPage), { timeout: 60_000 }).toBeGreaterThan(0.05);
      await expect
        .poll(() => remoteSoundLevel(alicePage), { timeout: 60_000 })
        .toBeGreaterThan(0.05);

      // Alice mutes; Bob sees it on her tile.
      await callPanel(alicePage).getByRole('button', { name: 'Turn Off Microphone' }).click();
      await expect(
        tileOf(bobPage, alice.userId).getByRole('img', { name: 'Microphone off' })
      ).toBeVisible({
        timeout: 30_000,
      });

      // Bob starts his camera; Alice sees his video.
      await callPanel(bobPage).getByRole('button', { name: 'Start Camera' }).click();
      await expect(tileOf(alicePage, bob.userId).locator('video')).toBeVisible({ timeout: 30_000 });

      // The device menu lists the fake devices.
      await callPanel(bobPage).getByRole('button', { name: 'Settings' }).click();
      const devices = bobPage.getByRole('menu', { name: 'Devices' });
      await expect(devices.getByRole('menuitemradio').first()).toBeVisible();
      await bobPage.keyboard.press('Escape');

      // Alice hangs up: Bob is alone, and the room shows one person in the call.
      await callPanel(alicePage).getByRole('button', { name: 'End' }).click();
      await expect(tileOf(bobPage, alice.userId)).toHaveCount(0, { timeout: 30_000 });
      await expect(alicePage.locator('[data-call-tab]')).toHaveCount(0);
      await expect(callPanel(alicePage)).toContainText('1 person in the call', { timeout: 30_000 });
      await callPanel(bobPage).getByRole('button', { name: 'End' }).click();
      await expect(callPanel(alicePage)).toContainText('Be the first to hop in', {
        timeout: 30_000,
      });
    });
  }

  test('calling an agent uses its call room with the conversation as origin', async ({
    browser,
  }) => {
    const alice = await register(`alicea${RUN}`, 'Alice Caller');
    const agent = await register(`mindroom_helper${RUN}`, 'Helper');
    await matrix(`/presence/${encodeURIComponent(agent.userId)}/status`, {
      token: agent.token,
      method: 'PUT',
      body: { presence: 'online', status_msg: '📞 Voice calls' },
    });
    const { room_id: roomId } = await matrix<{ room_id: string }>('/createRoom', {
      token: alice.token,
      body: { name: 'Planning', preset: 'private_chat', invite: [agent.userId] },
    });
    await matrix(`/join/${encodeURIComponent(roomId)}`, { token: agent.token, body: {} });

    const alicePage = await signIn(browser, `alicea${RUN}`);
    await openRoom(alicePage, roomId);
    const callAgent = alicePage.getByRole('button', { name: 'Call Helper' });
    await expect(callAgent).toBeVisible({ timeout: 60_000 });
    await callAgent.click();

    // The call runs in the call room, shown beside the conversation it is about.
    await expect(callPanel(alicePage)).toContainText('Call with Helper', { timeout: 60_000 });
    await expect(tileOf(alicePage, alice.userId)).toHaveAttribute('data-connected', 'true', {
      timeout: 60_000,
    });
    await expect(tileOf(alicePage, agent.userId)).toHaveCount(0);

    // The agent was invited to the call room, which names Alice's conversation as the origin.
    const { rooms } = await matrix<{ rooms: { invite: Record<string, unknown> } }>(
      '/sync?timeout=0',
      { token: agent.token }
    );
    const callRoomId = Object.keys(rooms.invite)[0];
    expect(callRoomId).toBeTruthy();
    await matrix(`/join/${encodeURIComponent(callRoomId)}`, { token: agent.token, body: {} });
    const origin = await matrix<Record<string, unknown>>(
      `/rooms/${encodeURIComponent(callRoomId)}/state/io.mindroom.agent_call/`,
      { token: agent.token }
    );
    expect(origin).toMatchObject({
      version: 1,
      agent_user_id: agent.userId,
      creator_user_id: alice.userId,
      ephemeral: false,
      origin: { room_id: roomId, thread_id: null },
    });

    // The agent joins the call from its own session, and Alice sees and hears it.
    const agentPage = await signIn(browser, `mindroom_helper${RUN}`);
    await agentPage.goto(`/home/${encodeURIComponent(callRoomId)}/`);
    await agentPage.locator('[data-room-call-button]').click();
    await callPanel(agentPage).getByRole('button', { name: 'Join', exact: true }).click();
    await expect(tileOf(alicePage, agent.userId)).toHaveAttribute('data-connected', 'true', {
      timeout: 60_000,
    });
    await expect.poll(() => remoteSoundLevel(alicePage), { timeout: 60_000 }).toBeGreaterThan(0.05);

    // A failure notice from the agent shows in the panel until dismissed.
    await matrix(`/rooms/${encodeURIComponent(callRoomId)}/send/m.room.message/fail${RUN}`, {
      token: agent.token,
      method: 'PUT',
      body: {
        msgtype: 'm.notice',
        body: 'Voice call error: the speech service rejected its key.',
        'chat.mindroom.call_failure': { version: 1 },
      },
    });
    const failure = callPanel(alicePage).getByText('the speech service rejected its key');
    await expect(failure).toBeVisible({ timeout: 30_000 });
    await alicePage.getByRole('button', { name: 'Dismiss voice call error' }).click();
    await expect(failure).toHaveCount(0);

    // Hanging up keeps the call room for the next call but clears this call's origin.
    await callPanel(alicePage).getByRole('button', { name: 'End' }).click();
    await expect(alicePage.locator('[data-call-tab]')).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await matrix<Record<string, unknown>>(
              `/rooms/${encodeURIComponent(callRoomId)}/state/io.mindroom.agent_call/`,
              { token: agent.token }
            )
          ).origin,
        { timeout: 30_000 }
      )
      .toBeUndefined();
  });
});
