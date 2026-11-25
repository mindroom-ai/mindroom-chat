import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SyncState, type MatrixClient, type Room } from 'matrix-js-sdk';
import 'folds/dist/style.css';
import '@fontsource-variable/inter';
import '../../src/index.css';
import i18n from '../../src/app/i18n/i18n';
import { DarkTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/matrix/hooks/useMatrixClient';
import { SpaceThreadsList } from '../../src/app/spaces/threads/SpaceThreadsList';
import * as css from '../../src/app/spaces/threads/SpaceThreads.css';
import { makeSpaceThreadEntry } from '../../src/app/spaces/threads/spaceThreads.test.shared';
import type { SpaceRoomItem } from '../../src/app/spaces/threads/spaceThreadsModel';
import type {
  CompactThreadSection,
  CompactThreadSectionId,
} from '../../src/app/threads/overview/compactThreadSections';

applyThemeToDom(DarkTheme);

const isFlat = new URLSearchParams(window.location.search).has('flat');
const NOW = Date.UTC(2026, 10, 24, 18, 0, 0);
const svgAvatar = (bg: string, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${bg}"/><text x="16" y="21" font-size="14" text-anchor="middle" font-family="sans-serif" fill="white">${label}</text></svg>`
  )}`;

const PEOPLE: readonly [string, string, string, string, string][] = [
  ['@alex:example.org', 'Alex', 'mxc://example.org/alex', '#4f8ff7', 'A'],
  ['@morgan:example.org', 'Morgan', 'mxc://example.org/morgan', '#2aa89b', 'M'],
];
const avatarUrls = new Map(PEOPLE.map(([, , mxc, bg, ch]) => [mxc, svgAvatar(bg, ch)]));
const members = new Map(
  PEOPLE.map(([userId, name, mxc]) => [
    userId,
    {
      userId,
      rawDisplayName: name,
      name,
      membership: 'join',
      disambiguate: false,
      getMxcAvatarUrl: () => mxc,
    },
  ])
);
const powerLevelsEvent = {
  getContent: () => ({ users_default: 50, state_default: 50, events_default: 0 }),
};
const createEvent = {
  getContent: () => ({ room_version: '11' }),
  getSender: () => '@alex:example.org',
};
const roomState = {
  getStateEvents: (type: string, stateKey?: string) => {
    if (type === 'm.room.power_levels') return powerLevelsEvent;
    if (type === 'm.room.create') return createEvent;
    return stateKey === undefined ? [] : null;
  },
};
const roomsById = new Map<string, SpaceRoomItem>();
const mx = {
  getSafeUserId: () => '@morgan:example.org',
  getUserId: () => '@morgan:example.org',
  getHomeserverUrl: () => 'https://example.org',
  getRoom: (id: string) => roomsById.get(id)?.room ?? null,
  getSyncState: () => SyncState.Syncing,
  on: () => undefined,
  removeListener: () => undefined,
  mxcUrlToHttp: (mxcUrl: string) => avatarUrls.get(mxcUrl) ?? null,
} as unknown as MatrixClient;
const ROOMS: readonly SpaceRoomItem[] = (
  [
    ['backend-api', '#4f8ff7'],
    ['web-client', '#3ba66b'],
  ] as const
).map(([name, accentColor]) => {
  const roomId = `!${name}:example.org`;
  const item: SpaceRoomItem = {
    name,
    accentColor,
    room: {
      roomId,
      name,
      client: mx,
      getMember: (userId: string) => members.get(userId) ?? null,
      getMembers: () => [...members.values()],
      getThread: () => undefined,
      findEventById: () => undefined,
      getUnfilteredTimelineSet: () => ({ findEventById: () => undefined }),
      getLiveTimeline: () => ({ getState: () => roomState }),
      currentState: roomState,
      on: () => undefined,
      off: () => undefined,
      removeListener: () => undefined,
    } as unknown as Room,
  };
  roomsById.set(roomId, item);
  return item;
});

const buildEntry = (
  i: number,
  prefix: string,
  title: string,
  preview: string,
  opts: { unread?: boolean; streaming?: boolean; ageMin: number }
) => {
  const roomItem = ROOMS[i % ROOMS.length]!;
  const participants = opts.streaming
    ? ['@morgan:example.org', '@alex:example.org']
    : ['@alex:example.org', '@morgan:example.org'];
  return makeSpaceThreadEntry({
    roomId: roomItem.room.roomId,
    roomName: roomItem.name,
    threadRootId: `$${prefix}-${i + 1}`,
    summaryText: title,
    rootPreviewText: preview,
    latestReplyPreviewText: preview,
    rootSenderId: participants[0],
    participantIds: participants,
    replyCount: 3 + (i % 7),
    lastActivityTs: NOW - opts.ageMin * 60_000,
    isUnread: Boolean(opts.unread),
    isStreaming: Boolean(opts.streaming),
  });
};

const needsYouEntries = [
  ['API cache rollout', 'Can we confirm the TTL cap before enabling regional shards?'],
  ['Queue retry backoff', 'Dead-letter spikes settled once jitter was bounded to 30 seconds.'],
  ['Dark mode contrast audit', 'Badge borders pass 4.5:1 on the secondary surface token now.'],
  ['Worker pool drain', 'Graceful shutdown waited 12s for the final batch to checkpoint.'],
  ['Schema migration rehearsal', 'Dry run finished cleanly against the staging snapshot in 42s.'],
  ['Keyboard focus restoration', 'Closing the filter menu returns focus to the trigger button.'],
  ['Webhook signature rotation', 'Dual-key verification window is ready for the Tuesday cutover.'],
  ['Table column resize jitter', 'Clamping minimum column width removed the horizontal flicker.'],
].map(([title, preview], i) =>
  buildEntry(i, 'needs', title!, preview!, { unread: true, ageMin: (i + 1) * 5 })
);

const workingEntries = [
  ['Streaming log parser benchmark', 'Comparing zero-copy line splitting across 50 MB fixtures.'],
  ['Cursor pagination edge cases', 'Testing concurrent inserts around page boundaries now.'],
  [
    'Popover collision boundary check',
    'Recalculating placement offsets near compact viewport edges.',
  ],
  ['Metrics batch flush interval', 'Profiling queue depth under bursty synthetic traffic.'],
].map(([title, preview], i) =>
  buildEntry(i, 'working', title!, preview!, { streaming: true, ageMin: i + 1 })
);

const quietEntries = Array.from({ length: 20 }, (_, i) =>
  buildEntry(
    i,
    'quiet',
    `Archive maintenance task ${i + 1}`,
    `Completed background check ${i + 1} with no warnings.`,
    { ageMin: 180 + i * 15 }
  )
);

const allEntries = [...needsYouEntries, ...workingEntries, ...quietEntries];
const entryByKey = new Map(allEntries.map((entry) => [entry.key, entry]));
const sections: readonly CompactThreadSection[] = [
  { id: 'needsYou', rootIds: needsYouEntries.map((e) => e.key) },
  { id: 'working', rootIds: workingEntries.map((e) => e.key) },
  { id: 'quiet', rootIds: quietEntries.map((e) => e.key) },
];

function Fixture() {
  const [folded, setFolded] = useState<readonly CompactThreadSectionId[]>(['quiet']);
  return (
    <MatrixClientProvider value={mx}>
      <div className={css.PageBody} style={{ width: 1100, height: 680 }}>
        <SpaceThreadsList
          entryKeys={allEntries.map((e) => e.key)}
          entryByKey={entryByKey}
          sections={isFlat ? undefined : sections}
          foldedSections={folded}
          onToggleSectionFold={(id) =>
            setFolded((prev) =>
              prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
            )
          }
          roomsById={roomsById}
          showRoomBadge
          snoozeNow={NOW}
          metaVersion={1}
          showLoading={false}
          onOpenThread={() => undefined}
        />
      </div>
    </MatrixClientProvider>
  );
}

void i18n.changeLanguage('en').then(async () => {
  createRoot(document.getElementById('root')!).render(<Fixture />);
  await document.fonts.ready;
  document.body.dataset.fixtureReady = 'true';
});
