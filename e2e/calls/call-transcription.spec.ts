import { readFileSync } from 'node:fs';
import type { Browser, Locator, Page } from '@playwright/test';
import { joinRoom, matrixFetch } from '../helpers/matrix';
import {
  bodyOf,
  expect,
  inThread,
  lobbyEvents,
  routeClientConfig,
  signIn,
  test,
  uniqueWord,
  type AgentStack,
  type MatrixEvent,
} from '../helpers/agentStack';

// Call transcription end to end: two people in a real LiveKit call in the agent stack's lobby,
// where MindRoom's router is a member, each browser's microphone playing a spoken recording
// (e2e/fixtures/agent-call-question.wav, "What is the capital of France? Please answer in one
// short sentence."). Each app finds the speech in the microphone it publishes and uploads it to
// MindRoom, and the live transcript shows each line under its speaker's name, inside the floating
// call window. One pauses: the other's controls say who paused, what the other says meanwhile is
// not transcribed, and once resumed the live transcript shows a gap. Docked, the call's live
// transcript opens in the room's side panel instead, with the same lines. Both leave: the router
// edits the call's row to ended and posts the notes and the whole transcript in the row's thread,
// which shows as the transcript card. All in the lobby's default view.
//
// With the stack's stand-in speech-to-text (scripts/agent-stack/stub_model.py) each line says how
// long its stretch of speech was, and the stub model writes the notes. With
// E2E_AGENT_TRANSCRIPTION=real, OpenAI's speech-to-text writes the words said and GPT-6 Luna the
// notes, with OPENAI_API_KEY from the environment. Each app signs in to MindRoom's client routes
// with OpenID tokens the slot's homeserver binds, so the stack runs with --client-sessions. Needs a
// MindRoom checkout with call transcripts and the call service, so it skips without either:
//   set -a; . <key file>; set +a   # for E2E_AGENT_TRANSCRIPTION=real only
//   E2E_MINDROOM_CHECKOUT=<checkout> E2E_MINDROOM_REF=<commit> E2E_AGENT_STACK_ROOT=<private dir> \
//     scripts/e2e-slot.sh <slot> --rtc --preview npx playwright test e2e/calls/call-transcription.spec.ts
const SERVICE = process.env.E2E_LIVEKIT_SERVICE_URL;
const SPEECH = readFileSync(
  new URL('../fixtures/agent-call-question.wav', import.meta.url)
).toString('base64');
const PASSWORD = 'call-transcription-password';
const TESTER_NAME = 'Tester';
// Unique, so a guest a run before left in the stack's lobby never shares the name.
const GUEST_NAME = `Bob ${Date.now().toString(36)}`;

test.skip(!SERVICE, 'needs the call service: scripts/e2e-slot.sh <slot> --rtc');

test.use({
  agentStackArgs: ['--client-sessions'],
  permissions: ['microphone'],
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

test.describe.configure({ timeout: 360_000 });

type Microphone = {
  /** Plays a WAV (base64) into every microphone the page opened; resolves with its length in seconds. */
  speak: (wav: string) => Promise<number>;
};

/** Runs in the page before the app: the microphones it opens are silent until the test speaks. */
const installMicrophone = () => {
  const audio = new AudioContext({ sampleRate: 48_000 });
  const microphones: MediaStreamAudioDestinationNode[] = [];
  const openDevices = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    const stream = await openDevices(constraints);
    if (!constraints?.audio) return stream;
    const microphone = audio.createMediaStreamDestination();
    microphones.push(microphone);
    stream.getAudioTracks().forEach((track) => {
      stream.removeTrack(track);
      track.stop();
    });
    const [track] = microphone.stream.getAudioTracks();
    if (track) stream.addTrack(track);
    return stream;
  };
  const microphone: Microphone = {
    async speak(wav) {
      await audio.resume();
      const bytes = Uint8Array.from(atob(wav), (char) => char.charCodeAt(0));
      const clip = await audio.decodeAudioData(bytes.buffer);
      microphones.forEach((destination) => {
        const player = audio.createBufferSource();
        player.buffer = clip;
        player.connect(destination);
        player.start();
      });
      return clip.duration;
    },
  };
  (window as unknown as { microphone: Microphone }).microphone = microphone;
};

/** Speaks the recording into the page's microphone and waits until it has been said. */
const speak = async (page: Page) => {
  const seconds = await page.evaluate(
    (wav) => (window as unknown as { microphone: Microphone }).microphone.speak(wav),
    SPEECH
  );
  await page.waitForTimeout(seconds * 1000);
};

const bindsOpenIdTokens = async (stack: AgentStack): Promise<boolean> => {
  const versions = (await (await fetch(`${stack.homeserver}/_matrix/client/versions`)).json()) as {
    unstable_features?: Record<string, boolean>;
  };
  return versions.unstable_features?.['io.mindroom.openid_audience'] === true;
};

/** A second person in the lobby, signed in on a browser of their own. */
const signInGuest = async (browser: Browser, stack: AgentStack) => {
  const username = uniqueWord('bob');
  const { access_token: accessToken, user_id: userId } = await matrixFetch<{
    access_token: string;
    user_id: string;
  }>(stack.homeserver, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  await matrixFetch(stack.homeserver, `/profile/${encodeURIComponent(userId)}/displayname`, {
    method: 'PUT',
    accessToken,
    body: JSON.stringify({ displayname: GUEST_NAME }),
  });
  await matrixFetch(stack.homeserver, `/rooms/${encodeURIComponent(stack.rooms.lobby)}/invite`, {
    method: 'POST',
    accessToken: stack.tester.accessToken,
    body: JSON.stringify({ user_id: userId }),
  });
  await joinRoom(stack.homeserver, accessToken, stack.rooms.lobby);
  const context = await browser.newContext({
    storageState: undefined,
    permissions: ['microphone'],
  });
  const page = await context.newPage();
  await page.addInitScript(installMicrophone);
  await routeClientConfig(page, stack);
  await signIn(page, stack, { username, password: PASSWORD });
  return { page, userId };
};

const callPanel = (page: Page) => page.getByTestId('call-panel');

/** Opens the lobby in its default view. */
const openLobby = (page: Page, stack: AgentStack) =>
  page.goto(`/home/${encodeURIComponent(stack.rooms.lobby)}`, { timeout: 180_000 });

/** The router's row in the default view's list (Compact): its card shows the row itself. */
const listedRow = async (page: Page) => {
  const card = page
    .locator('[data-scroll-anchor]')
    .filter({ has: page.locator('[data-call-row]') });
  const row = card.locator('[data-call-row]');
  await expect(row).toContainText('Call in progress', { timeout: 60_000 });
  return { card, row };
};

/** Joins the call from the open call panel, once MindRoom transcribes it. */
const joinCall = async (page: Page, userId: string) => {
  await callPanel(page).getByRole('button', { name: 'Join', exact: true }).click();
  await expect(callPanel(page).locator(`[data-call-tile="${userId}"]`)).toHaveAttribute(
    'data-connected',
    'true',
    { timeout: 60_000 }
  );
  // Pause and the live transcript are in the controls once MindRoom answered the join.
  await expect(callPanel(page).getByRole('button', { name: 'Live transcript' })).toBeVisible({
    timeout: 60_000,
  });
};

/** The live transcript's runs of speech under one speaker's name. */
const linesOf = (log: Locator, name: string) =>
  log
    .locator('li')
    .filter({ has: log.page().locator('[data-live-transcript-name]', { hasText: name }) })
    .locator('[data-live-transcript-text]');

const callContent = (event: MatrixEvent) =>
  event.content['io.mindroom.call'] as
    | { call_id: string; duration_seconds?: number; transcript_event_id?: string }
    | undefined;

test("two people in a call are transcribed under their names, Pause leaves a gap, and the notes arrive in the row's thread", async ({
  page,
  browser,
  stack,
}) => {
  test.skip(!stack.transcription, 'the MindRoom checkout has no call transcripts');
  test.skip(
    !(await bindsOpenIdTokens(stack)),
    'needs a homeserver that binds OpenID tokens (e2e/docker-compose.yaml)'
  );
  const real = stack.transcription?.stt === 'real';
  // What each line says: the stand-in's length of speech, or the recording's words.
  const spoken = real
    ? /capital of France/i
    : /^Stand-in transcript of \d+\.\d seconds of speech\.$/;

  await page.addInitScript(installMicrophone);
  const guest = await signInGuest(browser, stack);
  try {
    // The tester starts the call from the room header; the router posts its row.
    await openLobby(page, stack);
    await page.locator('[data-room-call-button]').click({ timeout: 90_000 });
    await joinCall(page, stack.tester.userId);

    // The guest finds the call on in the row, with the tester in it as the row reads it (every 5
    // seconds while in view), and joins from the row.
    await openLobby(guest.page, stack);
    const { row: guestRow } = await listedRow(guest.page);
    await expect(guestRow.locator('[data-call-row-member]')).toHaveCount(1, { timeout: 30_000 });
    await guestRow.getByRole('button', { name: 'Join', exact: true }).click();
    await joinCall(guest.page, guest.userId);

    // For the tester the row has both in the call and no Join for the call this device is in. The
    // call view floats, so the row's Transcript shows the live transcript inside the call window,
    // under the stage, and the window stays; the side panel stays shut.
    const { card: listed, row } = await listedRow(page);
    const rowId = await listed.getAttribute('data-scroll-anchor');
    await expect(row.locator('[data-call-row-member]')).toHaveCount(2, { timeout: 30_000 });
    await expect(row.getByRole('button', { name: 'Join', exact: true })).toHaveCount(0);
    await row.getByRole('button', { name: 'Transcript', exact: true }).click();
    const callWindow = page.getByTestId('call-window');
    const inWindow = callWindow.locator('[data-call-window-transcript]');
    await expect(inWindow).toContainText('This call is transcribed.');
    await expect(callWindow.locator('[data-call-transcript-layout]')).toHaveAttribute(
      'data-call-transcript-layout',
      'stacked'
    );
    await expect(callWindow.locator('[data-call-stage]')).toBeVisible();
    await expect(page.getByTestId('live-transcript-panel')).toHaveCount(0);
    const transcriptSwitch = callWindow.getByRole('button', { name: 'Live transcript' });
    await expect(transcriptSwitch).toHaveAttribute('aria-pressed', 'true');
    const log = inWindow.getByRole('log');

    // Each one's speech appears under their own name.
    await speak(page);
    await expect(linesOf(log, TESTER_NAME)).toHaveText([spoken], { timeout: 60_000 });
    await speak(guest.page);
    await expect(linesOf(log, GUEST_NAME)).toHaveText([spoken], { timeout: 60_000 });

    // The tester pauses: the guest's controls say so (from the guest's next read of the call), and
    // what the guest says meanwhile is not transcribed. Resuming leaves one gap in the live
    // transcript.
    const pause = callWindow.getByRole('button', { name: 'Pause transcription' });
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await expect(
      callPanel(guest.page)
        .getByRole('status')
        .filter({ hasText: `Paused by ${TESTER_NAME}` })
    ).toBeVisible({ timeout: 30_000 });
    await speak(guest.page);
    await guest.page.waitForTimeout(3_000);
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
    await expect(log.locator('[data-live-transcript-gap]')).toHaveText(['Paused'], {
      timeout: 30_000,
    });
    await expect(callPanel(guest.page).getByRole('status')).not.toContainText('Paused by');
    await expect(log.locator('[data-live-transcript-text]')).toHaveCount(2);

    // The switch hides the transcript again; the window and its call stay.
    await transcriptSwitch.click();
    await expect(transcriptSwitch).toHaveAttribute('aria-pressed', 'false');
    await expect(inWindow).toHaveCount(0);
    await expect(callWindow.locator('[data-call-stage]')).toBeVisible();

    // Docked, the call view's Transcript opens the live transcript in the room's side panel in its
    // place, with who is in the call and the same lines.
    await callWindow.getByRole('button', { name: 'Dock to the side' }).click();
    await expect(callWindow).toHaveCount(0);
    await callPanel(page).getByRole('button', { name: 'Live transcript' }).click();
    const panel = page.getByTestId('live-transcript-panel');
    await expect(callPanel(page)).toHaveCount(0);
    await expect(panel).toContainText('This call is transcribed.');
    const members = panel.locator('[data-live-transcript-member]');
    await expect(members).toHaveCount(2, { timeout: 30_000 });
    await expect(members.filter({ hasText: TESTER_NAME })).toHaveCount(1);
    await expect(members.filter({ hasText: GUEST_NAME })).toHaveCount(1);
    const panelLog = panel.getByRole('log');
    await expect(panelLog.locator('[data-live-transcript-text]')).toHaveText([spoken, spoken]);
    await expect(panelLog.locator('[data-live-transcript-gap]')).toHaveText(['Paused']);

    // Both leave. Closing the live transcript brings the call panel back.
    await panel.getByRole('button', { name: 'Close the live transcript' }).click();
    await callPanel(page).getByRole('button', { name: 'End' }).click();
    await callPanel(guest.page).getByRole('button', { name: 'End' }).click();
    await expect(page.locator('[data-call-tab]')).toHaveCount(0);

    // The row is edited to ended, and again once the transcript message is in its thread.
    await expect(row).toContainText('Call ended', { timeout: 60_000 });
    const notesLink = row.getByRole('button', { name: 'Notes and transcript' });
    await expect(notesLink).toBeVisible({ timeout: 150_000 });

    // As the homeserver has them: the row's latest edit names the message, which holds the notes
    // and both people's turns, the paused stretch left out.
    const events = await lobbyEvents(stack);
    const rowEvent = events.find((event) => event.event_id === rowId);
    expect(rowEvent?.sender).toBe(stack.agents.router);
    const rowCall = rowEvent && callContent(rowEvent);
    expect(rowCall?.duration_seconds).toBeGreaterThan(0);
    const message = events.find((event) => event.event_id === rowCall?.transcript_event_id);
    expect(message && inThread(message, rowId ?? '')).toBe(true);
    expect(message?.content['io.mindroom.call_notes']).toEqual({ call_id: rowCall?.call_id });
    const transcript = message?.content['io.mindroom.call_transcript'] as {
      turns: { sender: string; text: string }[];
    };
    expect(transcript.turns.map((turn) => turn.sender)).toEqual([
      stack.tester.userId,
      guest.userId,
    ]);
    transcript.turns.forEach((turn) => expect(turn.text).toMatch(spoken));
    const notes = real ? /France|capital/i : /Stub notes of the call\./;
    expect(bodyOf(message as MatrixEvent)).toMatch(notes);

    // The row's link opens its thread on the message, shown as the call's transcript card: the
    // notes, then the transcript under each speaker's name.
    await notesLink.click();
    const card = page.locator(`[data-message-id="${message?.event_id}"] [data-call-transcript]`);
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.locator('[data-call-transcript-header]')).toContainText('Call');
    await expect(card.locator('[data-call-transcript-notes]')).toContainText(notes);
    await card.getByRole('button', { name: /Transcript/ }).click();
    await expect(card.locator('[data-call-transcript-name]')).toHaveText([TESTER_NAME, GUEST_NAME]);
    await expect(card.locator('[data-call-transcript-text]')).toHaveText([spoken, spoken]);

    // Back in the lobby's list, the row's card says the call ended and holds the message, and the
    // row in it links to the message too.
    await page
      .locator('[data-thread-context-banner]')
      .getByRole('button', { name: 'Back', exact: true })
      .click();
    const rowCard = page.locator(`[data-thread-root-id="${rowId}"]`);
    await expect(rowCard).toContainText(/Call ended · \d+ min/, { timeout: 30_000 });
    await expect(rowCard.locator('[data-compact-card-reply-count]')).toHaveText('1');
    await expect(row).toContainText('Call ended');
    await expect(row.getByRole('button', { name: 'Notes and transcript' })).toBeVisible();
  } finally {
    await guest.page.context().close();
  }
});
