import { spawnSync } from 'node:child_process';

/**
 * Playwright global setup: gives the specs the environment variables they read.
 *
 * Variables the specs read (all optional; a spec that lacks one skips itself):
 *
 * | Variable | Used for |
 * | --- | --- |
 * | `E2E_HOMESERVER` | Homeserver base URL (a full URL); falls back to `config.mindroom.json`, then `mindroom.chat` |
 * | `E2E_USERNAME`, `E2E_PASSWORD` | Primary account (`live/` specs, account specs, fixture-room seeding) |
 * | `E2E_SECOND_USERNAME`, `E2E_SECOND_PASSWORD` | Second account (multi-account specs) |
 * | `E2E_THIRD_USERNAME`, `E2E_THIRD_PASSWORD` | Third account (three-account spec) |
 * | `E2E_DEACTIVATE_USERNAME`, `E2E_DEACTIVATE_PASSWORD` | Account that the deactivation spec destroys |
 * | `E2E_AGENT_USERNAME`, `E2E_AGENT_PASSWORD`, `E2E_AGENT_USER_ID` | An agent account (a `mindroom_` user) |
 * | `E2E_UI_ACTIONS_HOMESERVER` | Disposable homeserver with open registration; those specs register their own users |
 * | `E2E_FIXTURE_ROOM_ALIAS`, `E2E_FIXTURE_ROOM_ID` | Fixture room made by `e2e/live/seed-fixture-room.mjs` |
 * | `E2E_ROOM_ID`, `E2E_EXPECT_RAW_MATRIX_ID` | Room and display-name checks in single `live/` specs |
 * | `E2E_DEPLOYED_BASE_URL`, `E2E_DEPLOYED_HOMESERVER`, `E2E_DEPLOYED_USERNAME`, `E2E_DEPLOYED_PASSWORD` | Specs against a deployed client |
 * | `E2E_COMPUTER_FIXTURE` | Path of the gateway fixture JSON for the worker-computer spec |
 * | `E2E_SCREENSHOT_VARIANT`, `SHOT_PREFIX` | App Store screenshot spec output |
 * | `PERF_*`, `REPRO_REPLY_COUNT`, `IOS_INVARIANT_REPLY_COUNT` | Sizes of the `live/perf-*` and iOS specs |
 * | `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Browser for specs that launch their own (`just e2e` copies `CHROMIUM_PATH` into it) |
 *
 * With no `E2E_USERNAME` and a homeserver on http://127.0.0.1:28008 (`just hs-up`; the port is E2E_MATRIX_PORT when set), this
 * registers one account per role on that disposable server, creates the fixture room, and
 * exports the variables above for them. It never registers anything on another homeserver.
 * Variables that are already set win.
 */

export const LOCAL_HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const LOCAL_SERVER_NAME = 'matrix.localhost';
const LOCAL_PASSWORD = 'e2e-local-password';
const FIXTURE_ROOM_ALIAS = `#mindroom-e2e-fixture:${LOCAL_SERVER_NAME}`;

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${LOCAL_HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const register = async (username: string): Promise<void> => {
  const response = await fetch(`${LOCAL_HOMESERVER}/_matrix/client/v3/register`, {
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
  const result = spawnSync(process.execPath, ['e2e/live/seed-fixture-room.mjs'], {
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

const globalSetup = async (): Promise<void> => {
  // Credentials from the caller mean a homeserver of the caller's choosing.
  if (process.env.E2E_USERNAME) return;
  if ((process.env.E2E_HOMESERVER ?? LOCAL_HOMESERVER) !== LOCAL_HOMESERVER) return;
  if (!(await homeserverIsUp())) {
    console.warn(
      `No homeserver at ${LOCAL_HOMESERVER}; run \`just hs-up\` for the specs that need one.`
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

  process.env.E2E_HOMESERVER = LOCAL_HOMESERVER;
  process.env.E2E_UI_ACTIONS_HOMESERVER ??= LOCAL_HOMESERVER;
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
};

export default globalSetup;
