import { spawnSync } from 'node:child_process';
import { DISPOSABLE_HOMESERVER, disposableHomeserverIsUp } from './helpers/disposableAccounts';

/**
 * Playwright global setup: gives the specs the environment variables they read.
 *
 * Variables the specs read (all optional; a spec that lacks one skips itself):
 *
 * | Variable | Used for |
 * | --- | --- |
 * | `E2E_HOMESERVER` | Homeserver base URL (a full URL); falls back to `config.mindroom.json`, then `mindroom.chat` |
 * | `E2E_USERNAME`, `E2E_PASSWORD` | Primary account (`*.live.spec.ts` specs, account specs, fixture-room seeding) |
 * | `E2E_SECOND_USERNAME`, `E2E_SECOND_PASSWORD` | Second account (multi-account specs) |
 * | `E2E_THIRD_USERNAME`, `E2E_THIRD_PASSWORD` | Third account (three-account spec) |
 * | `E2E_DEACTIVATE_USERNAME`, `E2E_DEACTIVATE_PASSWORD` | Account that the deactivation spec destroys |
 * | `E2E_AGENT_USERNAME`, `E2E_AGENT_PASSWORD`, `E2E_AGENT_USER_ID` | An agent account (a `mindroom_` user) |
 * | `E2E_UI_ACTIONS_HOMESERVER` | Disposable homeserver with open registration; those specs register their own users |
 * | `E2E_FIXTURE_ROOM_ALIAS`, `E2E_FIXTURE_ROOM_ID` | Fixture room made by `e2e/fixtures/live/seed-fixture-room.mjs` |
 * | `E2E_ROOM_ID`, `E2E_EXPECT_RAW_MATRIX_ID` | Room and display-name checks in single `*.live.spec.ts` specs; locally a room shared with the agent account |
 * | `E2E_DEPLOYED_BASE_URL`, `E2E_DEPLOYED_HOMESERVER`, `E2E_DEPLOYED_USERNAME`, `E2E_DEPLOYED_PASSWORD` | Specs against a deployed client |
 * | `E2E_COMPUTER_FIXTURE` | Path of the gateway fixture JSON for the worker-computer spec |
 * | `E2E_PLUGIN_DIRS` | Plugin directories of the agent stack and the app server (`scripts/agent-stack/stack.py`); `agent-plugin-directory` needs `e2e/fixtures/sample-plugin` among them |
 * | `E2E_SCREENSHOT_VARIANT`, `SHOT_PREFIX` | App Store screenshot spec output |
 * | `PERF_*`, `REPRO_REPLY_COUNT`, `IOS_INVARIANT_REPLY_COUNT` | Sizes of the `timeline/perf-*`, thread reply chip and iOS specs |
 * | `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Browser for specs that launch their own (`just e2e` copies `CHROMIUM_PATH` into it) |
 *
 * With no `E2E_USERNAME` and a homeserver on http://127.0.0.1:28008 (`just hs-up`; the port is E2E_MATRIX_PORT when set), this
 * registers one account per role on that disposable server, creates the fixture room, and
 * exports the variables above for them. A run that names `minimap-verify` also gets that spec's
 * Minimap Long Room, and one that names `app-store-screenshots` gets Sam Rivera's room and its
 * account as the primary one. It never registers anything on another homeserver.
 * Variables that are already set win.
 */

const LOCAL_SERVER_NAME = 'matrix.localhost';
const LOCAL_PASSWORD = 'e2e-local-password';
const FIXTURE_ROOM_ALIAS = `#mindroom-e2e-fixture:${LOCAL_SERVER_NAME}`;

const register = async (username: string): Promise<void> => {
  const response = await fetch(`${DISPOSABLE_HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: LOCAL_PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  if (response.ok) return;

  const body = (await response.json().catch(() => ({}))) as { errcode?: string; error?: string };
  // Accounts outlive a run (until `just hs-down`), and the password never changes.
  if (body.errcode === 'M_USER_IN_USE') return;
  throw new Error(`Registering ${username} failed: ${response.status} ${body.error ?? ''}`);
};

const seedFixtureRoom = (): void => {
  const result = spawnSync(process.execPath, ['e2e/fixtures/live/seed-fixture-room.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, E2E_FIXTURE_ROOM_ALIAS: FIXTURE_ROOM_ALIAS },
  });
  const roomId = /^\s*Room: (!\S+)$/m.exec(result.stdout)?.[1];
  if (result.status !== 0 || !roomId) {
    console.warn(`Fixture room was not seeded: ${(result.stderr || result.stdout).trim()}`);
    return;
  }

  process.env.E2E_FIXTURE_ROOM_ALIAS ??= FIXTURE_ROOM_ALIAS;
  process.env.E2E_FIXTURE_ROOM_ID ??= roomId;
};

const AGENT_ROOM_ALIAS_NAME = 'mindroom-e2e-agent-room';

/**
 * A room the primary account shares with the agent account, so the room shows its agent
 * controls (the thread filter bar's status toggles). Specs that take `E2E_ROOM_ID` open it.
 */
const seedAgentRoom = async (username: string, agentUserId: string): Promise<void> => {
  const api = `${DISPOSABLE_HOMESERVER}/_matrix/client/v3`;
  const json = { 'Content-Type': 'application/json' };
  const login = await fetch(`${api}/login`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password: LOCAL_PASSWORD,
    }),
  });
  if (!login.ok) {
    console.warn(`Agent room was not seeded: login returned ${login.status}`);
    return;
  }
  const { access_token: token } = (await login.json()) as { access_token: string };
  const headers = { ...json, Authorization: `Bearer ${token}` };
  try {
    const alias = `#${AGENT_ROOM_ALIAS_NAME}:${LOCAL_SERVER_NAME}`;
    const found = await fetch(`${api}/directory/room/${encodeURIComponent(alias)}`, { headers });
    let roomId = found.ok ? ((await found.json()) as { room_id: string }).room_id : undefined;
    if (!roomId) {
      const created = await fetch(`${api}/createRoom`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'E2E Agent Room',
          preset: 'private_chat',
          room_alias_name: AGENT_ROOM_ALIAS_NAME,
          invite: [agentUserId],
        }),
      });
      if (!created.ok) {
        console.warn(`Agent room was not seeded: createRoom returned ${created.status}`);
        return;
      }
      roomId = ((await created.json()) as { room_id: string }).room_id;
      await fetch(`${api}/rooms/${encodeURIComponent(roomId)}/send/m.room.message/agent-room-1`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ msgtype: 'm.text', body: 'Agent room thread' }),
      });
    }
    process.env.E2E_ROOM_ID ??= roomId;
  } finally {
    await fetch(`${api}/logout`, { method: 'POST', headers }).catch(() => undefined);
  }
};

/**
 * Whether this run's command line names the spec file, as `e2e-suite.sh` and `e2e-slot.sh` runs
 * do. Fixtures only one spec reads are seeded for runs that name it, so other runs never get them.
 */
const runNamesSpec = (fileStem: string): boolean =>
  process.argv.some((argument) => argument.includes(fileStem));

/** The Minimap Long Room and its long thread that `e2e/timeline/minimap-verify.live.spec.ts` opens. */
const seedMinimapRoom = (): void => {
  const result = spawnSync('bash', ['e2e/fixtures/live/minimap-fixture.sh'], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0 || !/^ROOM=!/m.test(result.stdout)) {
    console.warn(`Minimap room was not seeded: ${(result.stderr || result.stdout).trim()}`);
  }
};

/**
 * Sam Rivera's room of `e2e/diagnostics/app-store-screenshots.spec.ts`, seeded for an account of its own as
 * `scripts/appstore-fixture-up.sh` does, so the household's name and avatar never reach the shared
 * primary account. The spec signs in as the primary account, so this run's primary becomes it.
 */
const seedAppStoreRoom = async (): Promise<void> => {
  const runId = Date.now().toString(36);
  const username = `appstorescreenshots${runId}`;
  const alias = `#mindroom-app-store-personal-showcase-${runId}:${LOCAL_SERVER_NAME}`;
  await register(username);
  const result = spawnSync(process.execPath, ['scripts/seed-appstore-screenshot-room.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      E2E_USERNAME: username,
      E2E_PASSWORD: LOCAL_PASSWORD,
      E2E_FIXTURE_ROOM_ALIAS: alias,
    },
  });
  if (result.status !== 0 || !/^Room: !/m.test(result.stdout)) {
    console.warn(`App Store room was not seeded: ${(result.stderr || result.stdout).trim()}`);
    return;
  }
  process.env.E2E_USERNAME = username;
  process.env.E2E_FIXTURE_ROOM_ALIAS = alias;
  delete process.env.E2E_FIXTURE_ROOM_ID;
};

const globalSetup = async (): Promise<void> => {
  // Credentials from the caller mean a homeserver of the caller's choosing.
  if (process.env.E2E_USERNAME) return;
  if ((process.env.E2E_HOMESERVER ?? DISPOSABLE_HOMESERVER) !== DISPOSABLE_HOMESERVER) return;
  if (!(await disposableHomeserverIsUp())) {
    console.warn(
      `No homeserver at ${DISPOSABLE_HOMESERVER}; run \`just hs-up\` for the specs that need one.`
    );
    return;
  }

  // The deactivation spec destroys its account for good, so each run gets a new one.
  const deactivateUsername = `e2e_deactivate_${Date.now().toString(36)}`;
  const accounts = {
    primary: 'e2e_primary',
    second: 'e2e_second',
    third: 'e2e_third',
    deactivate: deactivateUsername,
    agent: 'mindroom_e2e_agent',
  };
  await Promise.all(Object.values(accounts).map(register));

  process.env.E2E_HOMESERVER = DISPOSABLE_HOMESERVER;
  process.env.E2E_UI_ACTIONS_HOMESERVER ??= DISPOSABLE_HOMESERVER;
  process.env.E2E_USERNAME = accounts.primary;
  process.env.E2E_PASSWORD = LOCAL_PASSWORD;
  process.env.E2E_SECOND_USERNAME ??= accounts.second;
  process.env.E2E_SECOND_PASSWORD ??= LOCAL_PASSWORD;
  process.env.E2E_THIRD_USERNAME ??= accounts.third;
  process.env.E2E_THIRD_PASSWORD ??= LOCAL_PASSWORD;
  process.env.E2E_DEACTIVATE_USERNAME ??= accounts.deactivate;
  process.env.E2E_DEACTIVATE_PASSWORD ??= LOCAL_PASSWORD;
  process.env.E2E_AGENT_USERNAME ??= accounts.agent;
  process.env.E2E_AGENT_PASSWORD ??= LOCAL_PASSWORD;
  process.env.E2E_AGENT_USER_ID ??= `@${accounts.agent}:${LOCAL_SERVER_NAME}`;

  seedFixtureRoom();
  await seedAgentRoom(accounts.primary, process.env.E2E_AGENT_USER_ID);
  if (runNamesSpec('minimap-verify')) seedMinimapRoom();
  // Last: it swaps the primary account, which the seeds above must not use.
  if (runNamesSpec('app-store-screenshots')) await seedAppStoreRoom();
};

export default globalSetup;
