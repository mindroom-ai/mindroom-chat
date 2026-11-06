import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_ROOT,
  appFile,
  appRelativePath,
  findDependencyCycles,
  memberAccesses,
  pathExists,
  resolvedDependencies,
  walkProductionSources,
} from '../../../test/architecture';

const TIMELINE = appFile('timeline/RoomTimeline.tsx');
const THREAD_SESSION = appFile('threads/open/useThreadSession.ts');
const THREAD_PAGINATION = appFile('threads/open/useThreadPagination.ts');
const THREAD_VIEWPORT = appFile('timeline/useThreadPrependViewport.ts');
const THREAD_BACK_CONTROLLER = appFile('timeline/threadBackPaginationController.ts');
const THREAD_LIFECYCLE_INSTALLER = appFile('threads/open/threadOpenLifecycleController.ts');
const THREAD_SEED_SCHEDULER = appFile('threads/open/threadSeedPrewarmController.ts');
const ROOM_SDK_OWNER = appFile('event-store/sdk/roomTimelineSdk.ts');
const THREAD_SDK_OWNER = appFile('event-store/sdk/threadBootstrapSdk.ts');

const fixtureDirectories: string[] = [];
const createFixtureDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'guards-ownership-'));
  fixtureDirectories.push(directory);
  return directory;
};

afterEach(() => {
  fixtureDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true }));
});

const dependencyViolations = (path: string, forbidden: ReadonlySet<string>): string[] =>
  [...resolvedDependencies(path)].filter((dependency) => forbidden.has(dependency));

const memberOwnership = (files: string[], names: ReadonlySet<string>) =>
  files.flatMap((file) => {
    const accesses = memberAccesses(file).filter((access) => names.has(access.name));
    return accesses.length === 0 ? [] : [{ file: appRelativePath(file), accesses }];
  });

describe('feature ownership architecture', () => {
  it('keeps the complete MindRoom runtime dependency graph acyclic', () => {
    const cycles = findDependencyCycles(walkProductionSources(APP_ROOT));
    // The one cycle, each file listed once: emoji/emojiData.ts loads emoji/emoji.ts on first use
    // with import(), and emoji.ts hands its tables back through provideEmojiData, whoever loaded it.
    expect(cycles.map((cycle) => [...new Set(cycle.map(appRelativePath))].sort())).toEqual([
      ['emoji/emoji.ts', 'emoji/emojiData.ts'],
    ]);
  });

  it('requires every reviewed owner and makes parent composition explicit', () => {
    const owners = [
      THREAD_SESSION,
      THREAD_PAGINATION,
      THREAD_VIEWPORT,
      THREAD_BACK_CONTROLLER,
      THREAD_LIFECYCLE_INSTALLER,
      THREAD_SEED_SCHEDULER,
      ROOM_SDK_OWNER,
      THREAD_SDK_OWNER,
    ];
    expect(owners.filter((path) => !pathExists(path))).toEqual([]);

    const timelineDependencies = resolvedDependencies(TIMELINE, { includeTypeOnly: false });
    expect([...timelineDependencies]).toEqual(
      expect.arrayContaining([
        THREAD_SESSION,
        THREAD_PAGINATION,
        THREAD_VIEWPORT,
        THREAD_BACK_CONTROLLER,
        THREAD_LIFECYCLE_INSTALLER,
        THREAD_SEED_SCHEDULER,
      ])
    );
  });

  it('does not accept a type-only edge as runtime owner consumption', () => {
    const directory = createFixtureDirectory();
    const owner = join(directory, 'owner.ts');
    const consumer = join(directory, 'consumer.ts');
    writeFileSync(owner, 'export type Owner = string;');
    writeFileSync(consumer, "import type { Owner } from './owner';");

    expect(resolvedDependencies(consumer)).toContain(owner);
    expect(resolvedDependencies(consumer, { includeTypeOnly: false })).not.toContain(owner);
  });

  it('detects a forbidden import fixture and keeps migrated thread internals behind session owners', () => {
    const directory = createFixtureDirectory();
    const owner = join(directory, 'owner.ts');
    const violator = join(directory, 'violator.ts');
    writeFileSync(owner, 'export const owner = true;');
    writeFileSync(violator, "import './owner';");
    expect(dependencyViolations(violator, new Set([owner]))).toEqual([owner]);

    const forbiddenParentDependencies = new Set([
      appFile('threads/open/threadOpenCacheController.ts'),
      appFile('threads/open/threadOpenCacheFirst.ts'),
      appFile('threads/open/threadOpenSdkBootstrap.ts'),
      appFile('threads/open/threadOpenTargetEvent.ts'),
      appFile('threads/open/threadOpenSeedController.ts'),
      THREAD_SDK_OWNER,
    ]);
    expect(
      [...resolvedDependencies(TIMELINE, { includeTypeOnly: false })].filter((dependency) =>
        forbiddenParentDependencies.has(dependency)
      )
    ).toEqual([]);

    const forbiddenSessionDependencies = new Set(
      walkProductionSources(appFile('timeline/message-rendering')).concat(TIMELINE)
    );
    expect(dependencyViolations(THREAD_SESSION, forbiddenSessionDependencies)).toEqual([]);
    expect(dependencyViolations(THREAD_PAGINATION, forbiddenSessionDependencies)).toEqual([]);

    const engineDependencies = walkProductionSources(appFile('event-store/engine')).flatMap((file) => [
      ...resolvedDependencies(file),
    ]);
    expect(engineDependencies).not.toContain(THREAD_SESSION);
    expect(engineDependencies).not.toContain(THREAD_PAGINATION);
  });

  it('detects dot and bracket ownership violations and confines brittle SDK operations', () => {
    const directory = createFixtureDirectory();
    const violator = join(directory, 'violator.ts');
    writeFileSync(
      violator,
      "thread.initialEventsFetched = true; thread['replayEvents'] = null; room['addLiveEvents']([]);"
    );
    expect(memberOwnership([violator], new Set(['initialEventsFetched', 'replayEvents']))).toEqual([
      {
        file: appRelativePath(violator),
        accesses: [
          { name: 'initialEventsFetched', kind: 'write' },
          { name: 'replayEvents', kind: 'write' },
        ],
      },
    ]);

    const appSources = walkProductionSources(APP_ROOT);
    expect(
      memberOwnership(appSources, new Set(['initialEventsFetched', 'replayEvents']))
    ).toEqual([
      {
        file: 'event-store/sdk/threadBootstrapSdk.ts',
        accesses: [
          { name: 'initialEventsFetched', kind: 'read' },
          { name: 'initialEventsFetched', kind: 'write' },
          { name: 'replayEvents', kind: 'write' },
        ],
      },
      // The client's fixes for unopened threads (matrix/client/) read this state and never write it.
      {
        file: 'matrix/client/threadListGaps.ts',
        accesses: [{ name: 'initialEventsFetched', kind: 'read' }],
      },
      {
        file: 'matrix/client/threadReplyCounts.ts',
        accesses: [{ name: 'initialEventsFetched', kind: 'read' }],
      },
      {
        file: 'matrix/client/unopenedThreadEdits.ts',
        accesses: [
          { name: 'replayEvents', kind: 'read' },
          { name: 'initialEventsFetched', kind: 'read' },
          { name: 'initialEventsFetched', kind: 'read' },
          { name: 'initialEventsFetched', kind: 'read' },
          { name: 'replayEvents', kind: 'read' },
        ],
      },
    ]);
    expect(
      memberOwnership(
        appSources,
        new Set([
          'addLiveEvents',
          'partitionThreadedEvents',
          'processAggregatedTimelineEvents',
          'processThreadRoots',
        ])
      ).map((entry) => entry.file)
    ).toEqual(['event-store/sdk/roomHistoryPageSdk.ts', 'event-store/sdk/roomTimelineSdk.ts']);
    expect(
      memberOwnership(appSources, new Set(['addEventsToTimeline'])).map((entry) => entry.file)
    ).toEqual([
      'event-store/sdk/roomHistoryPageSdk.ts',
      'event-store/sdk/roomTimelineSdk.ts',
      'event-store/sdk/threadBootstrapSdk.ts',
    ]);
  });
});
