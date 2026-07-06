import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  APPSTORE_FIXTURE_ROOM_ALIAS,
  APPSTORE_FIXTURE_ROOM_NAME,
  APPSTORE_FIXTURE_PRIMARY_AVATAR_ASSET_PATH,
  APPSTORE_FIXTURE_PRIMARY_DISPLAY_NAME,
  bodyToFormattedHtml,
  buildAppStoreFixtureThreads,
  buildCanonicalThreadTagStateKey,
  buildScheduledTaskContent,
  getAppStoreFixtureAgentDefinitions,
} from './appstore-fixture.mjs';

const SETUP_SCRIPT_URL = new URL('./appstore-fixture-up.sh', import.meta.url);
const SETUP_SCRIPT_PATH = fileURLToPath(SETUP_SCRIPT_URL);
const SCREENSHOT_SCRIPT_URL = new URL('./appstore-screenshots.sh', import.meta.url);
const SEED_SCRIPT_URL = new URL('./seed-appstore-screenshot-room.mjs', import.meta.url);

test('declares the public-safe App Store screenshot fixture room', () => {
  assert.equal(
    APPSTORE_FIXTURE_ROOM_ALIAS,
    '#mindroom-app-store-personal-showcase:matrix.localhost'
  );
  assert.equal(APPSTORE_FIXTURE_ROOM_NAME, 'Personal');
  assert.equal(APPSTORE_FIXTURE_PRIMARY_DISPLAY_NAME, 'Bas Nijholt');
  assert.equal(
    APPSTORE_FIXTURE_PRIMARY_AVATAR_ASSET_PATH,
    'public/res/appstore/bas-nijholt-avatar.jpg'
  );
});

test('defines fake AI agents with localpart prefixes and avatar assets', () => {
  const agents = getAppStoreFixtureAgentDefinitions();

  assert.deepEqual(
    agents.map((agent) => [agent.username, agent.displayName, agent.avatarAssetPath]),
    [
      ['mindroom_mind', 'Mind', 'public/res/branding/mindroom-logo-square.png'],
      ['mindroom_router', 'RouterAgent', 'public/res/branding/mindroom-favicon.png'],
    ]
  );
});

test('formats fixture markdown as Matrix HTML for richer screenshots', () => {
  assert.equal(
    bodyToFormattedHtml(
      [
        'MindRoom is chat-native.',
        '',
        '**Everyday examples**',
        '- Watch for **campground cancellations**.',
        '- Run `schedule next scan` when needed.',
      ].join('\n')
    ),
    '<p>MindRoom is chat-native.</p><p><strong>Everyday examples</strong></p><ul><li>Watch for <strong>campground cancellations</strong>.</li><li>Run <code>schedule next scan</code> when needed.</li></ul>'
  );
});

test('builds fake fixture threads with AI run, tool trace, and summary metadata', () => {
  const threads = buildAppStoreFixtureThreads({
    primaryUserId: '@appstorescreenshots:matrix.localhost',
    agentUserIds: {
      mind: '@mindroom_mind:matrix.localhost',
      router: '@mindroom_router:matrix.localhost',
    },
  });

  const mindroomThread = threads.find((thread) => thread.id === 'mindroom-explained');
  const toolThread = threads.find((thread) => thread.id === 'campground-monitor');
  assert.ok(mindroomThread);
  assert.ok(toolThread);

  assert.match(mindroomThread.root.body, /what MindRoom is/);
  assert.equal(mindroomThread.replies[0].sender, 'mind');
  assert.match(mindroomThread.replies[0].content.body, /personal AI agent platform/);
  assert.match(mindroomThread.replies[0].content.body, /campground cancellations/);
  assert.match(mindroomThread.replies[0].content.formatted_body, /<h2>Everyday examples<\/h2>/);
  assert.match(mindroomThread.replies[0].content.formatted_body, /<ul><li>Watch for/);
  assert.equal(mindroomThread.replies[0].content['io.mindroom.ai_run'].status, 'completed');
  assert.equal(mindroomThread.summary.content['io.mindroom.thread_summary'].version, 1);

  assert.match(toolThread.root.body, /campground cancellation/);
  assert.match(toolThread.replies[0].content.body, /🔧 `check campground availability` \[1\]/u);
  assert.equal(toolThread.replies[0].content['io.mindroom.tool_trace'].version, 2);
  assert.equal(
    toolThread.replies[0].content['io.mindroom.tool_trace'].events[0].tool_name,
    'check campground availability'
  );
});

test('uses starred summaries and varied realistic thread depths', () => {
  const threads = buildAppStoreFixtureThreads({
    primaryUserId: '@appstorescreenshots:matrix.localhost',
    agentUserIds: {
      mind: '@mindroom_mind:matrix.localhost',
      router: '@mindroom_router:matrix.localhost',
    },
  });
  const messageCounts = threads.map(
    (thread) => thread.summary.content['io.mindroom.thread_summary'].message_count
  );

  threads.forEach((thread) => {
    assert.match(thread.summary.content.body, /^⭐ /u, `${thread.id} summary needs a star`);
    assert.match(
      thread.summary.content['io.mindroom.thread_summary'].summary,
      /^⭐ /u,
      `${thread.id} metadata summary needs a star`
    );
  });
  assert.ok(
    messageCounts.some((count) => count >= 100),
    'at least one thread should look like a long-running thread'
  );
  assert.ok(
    messageCounts.some((count) => count <= 12),
    'at least one thread should remain a short thread'
  );
  assert.ok(
    new Set(messageCounts).size >= 4,
    'thread depths should be varied enough for a realistic overview'
  );
});

test('builds scheduled task and canonical tag state payloads for thread cards', () => {
  assert.deepEqual(buildScheduledTaskContent('$thread', '2026-07-05T18:00:00.000Z'), {
    status: 'pending',
    thread_id: '$thread',
    new_thread: false,
    execute_at: '2026-07-05T18:00:00.000Z',
  });

  assert.equal(buildCanonicalThreadTagStateKey('$thread', 'watcher'), '["$thread","watcher"]');
});

test('keeps seeded scheduled tasks safely in the future', () => {
  const threads = buildAppStoreFixtureThreads({
    primaryUserId: '@appstorescreenshots:matrix.localhost',
    agentUserIds: {
      mind: '@mindroom_mind:matrix.localhost',
      router: '@mindroom_router:matrix.localhost',
    },
  });
  const minimumFutureTime = Date.now() + 6 * 24 * 60 * 60 * 1000;
  const scheduledThreads = threads.filter((thread) => thread.scheduledAt);

  assert.equal(scheduledThreads.length, 2);
  scheduledThreads.forEach((thread) => {
    assert.ok(
      Date.parse(thread.scheduledAt) > minimumFutureTime,
      `${thread.id} scheduledAt should not expire immediately`
    );
  });
});

test('uses only Matrix-safe integer numbers in event payloads', () => {
  const threads = buildAppStoreFixtureThreads({
    primaryUserId: '@appstorescreenshots:matrix.localhost',
    agentUserIds: {
      mind: '@mindroom_mind:matrix.localhost',
      router: '@mindroom_router:matrix.localhost',
    },
  });

  const visit = (value, path = 'payload') => {
    if (typeof value === 'number') {
      assert.equal(Number.isSafeInteger(value), true, `${path} must be a safe integer`);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }

    Object.entries(value).forEach(([key, child]) => visit(child, `${path}.${key}`));
  };

  visit(threads);
});

test('keeps the screenshot fixture free of copied private-room examples', () => {
  const serialized = JSON.stringify(
    buildAppStoreFixtureThreads({
      primaryUserId: '@appstorescreenshots:matrix.localhost',
      agentUserIds: {
        mind: '@mindroom_mind:matrix.localhost',
        router: '@mindroom_router:matrix.localhost',
      },
    })
  ).toLowerCase();

  ['ionq', 'joe latone', 'mullvad', 'daycare', 'fetish', 'erotic'].forEach((term) => {
    assert.equal(serialized.includes(term), false, `fixture should not include ${term}`);
  });
});

test('standalone setup script starts Matrix and seeds the fixture room', async () => {
  const script = await readFile(SETUP_SCRIPT_URL, 'utf8');

  assert.match(script, /scripts\/e2e-matrix-up\.sh/);
  assert.match(script, /scripts\/ensure-e2e-account\.sh/);
  assert.match(script, /scripts\/seed-appstore-screenshot-room\.mjs/);
  assert.match(script, /APPSTORE_SCREENSHOT_RUN_ID/);
  assert.match(script, /appstorescreenshots\$\{SAFE_RUN_ID\}/);
  assert.match(
    script,
    /E2E_FIXTURE_ROOM_ALIAS="#mindroom-app-store-personal-showcase-\$\{APPSTORE_SCREENSHOT_RUN_ID\}:matrix\.localhost"/
  );
});

test('standalone setup script does not inherit stale room aliases', async () => {
  const script = await readFile(SETUP_SCRIPT_URL, 'utf8');

  assert.doesNotMatch(script, /E2E_FIXTURE_ROOM_ALIAS:-/);
});

test('seeder keeps Matrix media upload fallback resilient', async () => {
  const script = await readFile(SEED_SCRIPT_URL, 'utf8');

  assert.match(script, /for \(const uploadBase of uploadBases\) {\n\s+try {/);
  assert.match(
    script,
    /catch \(error\) {\n\s+lastError = error instanceof Error \? error\.message : String\(error\);/
  );
});

test('seeder reuses parsed registration challenge bodies', async () => {
  const script = await readFile(SEED_SCRIPT_URL, 'utf8');

  assert.match(script, /error\.body = body;/);
  assert.match(script, /const challenge = error\.body \?\? {};/);
  assert.doesNotMatch(
    script,
    /const initialResponse = await fetch\(`\$\{HOMESERVER\}\/_matrix\/client\/v3\/register`/
  );
});

test('screenshot capture removes every stale file from the locale folder', async () => {
  const script = await readFile(SCREENSHOT_SCRIPT_URL, 'utf8');

  assert.match(script, /find "\$\{SCREENSHOT_DIR\}" -maxdepth 1 -type f ! -name '\.\*' -delete/);
  assert.doesNotMatch(script, /_iphone-6-9_/);
  assert.doesNotMatch(script, /_ipad-13_/);
});

test('standalone setup script rejects existing live-account mode', () => {
  const result = spawnSync('bash', [SETUP_SCRIPT_PATH], {
    env: {
      PATH: process.env.PATH,
      APPSTORE_SCREENSHOTS_USE_EXISTING_E2E: '1',
    },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Existing live-account screenshot capture is not supported/);
});
