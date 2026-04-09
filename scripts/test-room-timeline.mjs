import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const vitestBin = path.join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest'
);

const testFile = 'src/app/features/room/RoomTimeline.test.ts';

const runVitest = (label, pattern) => {
  console.log(`\n[room-timeline] ${label}`);

  const result = spawnSync(
    vitestBin,
    ['run', testFile, '--minWorkers=1', '--maxWorkers=1', '--reporter=dot', '-t', pattern],
    {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit',
    }
  );

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.error) {
    throw result.error;
  }
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const runSingle = (groupName, testName) => {
  const pattern = `${escapeRegExp(groupName)}.*${escapeRegExp(testName)}$`;
  runVitest(`${groupName} :: ${testName}`, pattern);
};

runVitest('cache and overview', 'cache and overview');

const singleTests = [
  {
    group: 'filter navigation',
    tests: [
      'resets the room timeline to the latest live range when returning to all threads',
      'keeps the active filter when jumping to an unread event hidden by the overview',
      'maps hidden event targets to a visible neighbor instead of filtered index zero',
      'falls back to the closest renderable entry when all target candidates are hidden',
      'falls back to the last renderable entry when read-up-to is beyond all visible events',
      'scrolls to the next visible event when read-up-to is filtered out in the live timeline',
      'switches back to all threads before opening an eventId hidden by the active filter',
      'keeps the active thread filter when opening an unloaded eventId that still matches it',
      'keeps the unresolved filter when opening an unloaded unresolved thread root',
      'keeps the unresolved filter when opening an unloaded fallback-only thread root after permalink load',
      'detects unread divider boundaries when read-up-to is filtered out',
    ],
  },
  {
    group: 'room focus retry handling',
    tests: [
      'does not retrigger room focus scroll on unrelated live room updates',
      'tracks room-mode focus retries while the target event is still missing from the DOM',
      'maps hidden event targets to a visible neighbor instead of filtered index zero',
      'falls back to the closest renderable entry when all target candidates are hidden',
      'falls back to the last renderable entry when read-up-to is beyond all visible events',
      'scrolls to the next visible event when read-up-to is filtered out in the live timeline',
      'switches back to all threads before opening an eventId hidden by the active filter',
      'keeps the active thread filter when opening an unloaded eventId that still matches it',
      'keeps the unresolved filter when opening an unloaded unresolved thread root',
      'keeps the unresolved filter when opening an unloaded fallback-only thread root after permalink load',
      'detects unread divider boundaries when read-up-to is filtered out',
    ],
  },
  {
    group: 'permalink targeting',
    tests: [
      'computes room-event focus against the active thread-filtered room list',
      'computes room-event focus against the frozen overview order',
      'computes room-event focus against compact-only roots in the frozen compact order',
      'derives a thread redirect target for room-overview thread permalinks',
      'redirects compact-room permalinks into thread view',
      'keeps synthetic room-focus permalinks in compact room view',
      'bypasses room overview filters for synthetic room-focus routes',
      'lets synthetic room-focus routes switch between expanded and compact views',
      'uses stopInView=false for the explicit room focus scroll',
      'switches room focus to start alignment near the loaded room start',
    ],
  },
  {
    group: 'refresh and jump-to-latest',
    tests: [
      'switches room focus to end alignment near the loaded room end',
      'recenters focus during observed resize activity and finishes after the idle window',
      'cancels a pending room focus retry when the focused event changes',
      'does not focus room events hidden by the active filter',
      'coalesces queued refreshes and reruns after in-flight settles',
      'cancels a queued refresh when the thread closes mid-flight',
      'shows Jump to Latest when timeline is not at live end (non-live navigation)',
      'recovery effect hides Jump to Latest when anchor is visible and timelineAtLiveEnd flips to true',
      'isAnchorVisibleInScroll returns true when anchor is within scroll bounds plus margin',
      'isAnchorVisibleInScroll returns false when anchor is below scroll bounds plus margin',
    ],
  },
];

singleTests.forEach(({ group, tests }) => {
  tests.forEach((testName) => runSingle(group, testName));
});

runVitest('fetchAllThreadRelations', 'fetchAllThreadRelations');
