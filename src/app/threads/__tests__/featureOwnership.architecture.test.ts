import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MINDROOM_ROOT,
  appRelativePath,
  findDependencyCycles,
  memberAccesses,
  mindroomFile,
  moduleDependencies,
  parseSourceFile,
  pathExists,
  resolvedDependencies,
  walkProductionSources,
} from '../../../test/architecture';
import { filesMovedFrom } from '../../../test/movedFrom';

const TIMELINE = mindroomFile('timeline/RoomTimeline.tsx');
const THREAD_SESSION = mindroomFile('threads/open/useThreadSession.ts');
const THREAD_PAGINATION = mindroomFile('threads/open/useThreadPagination.ts');
const THREAD_VIEWPORT = mindroomFile('timeline/useThreadPrependViewport.ts');
const THREAD_BACK_CONTROLLER = mindroomFile('timeline/threadBackPaginationController.ts');
const THREAD_LIFECYCLE_INSTALLER = mindroomFile('threads/open/threadOpenLifecycleController.ts');
const THREAD_SEED_SCHEDULER = mindroomFile('threads/open/threadSeedPrewarmController.ts');
const ROOM_SDK_OWNER = mindroomFile('event-store/sdk/roomTimelineSdk.ts');
const THREAD_SDK_OWNER = mindroomFile('event-store/sdk/threadBootstrapSdk.ts');
const CAPTURE_OWNER = mindroomFile('composer/voice/voiceCaptureSession.ts');
const DRAFT_OWNER = mindroomFile('composer/voice/voiceSendDraftController.ts');
const VOICE_FACADE = mindroomFile('composer/voice/useVoiceRecorder.ts');

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

const constructedIdentifiers = (path: string): string[] => {
  const identifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      identifiers.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parseSourceFile(path));
  return identifiers;
};

describe('feature ownership architecture', () => {
  it('keeps the complete MindRoom runtime dependency graph acyclic', () => {
    const oldMindroom = new Set(filesMovedFrom('src/app/mindroom/'));
    const cycles = findDependencyCycles(
      walkProductionSources(MINDROOM_ROOT).filter((file) => oldMindroom.has(file))
    );
    expect(cycles.map((cycle) => cycle.map(appRelativePath).join(' -> '))).toEqual([]);
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
      CAPTURE_OWNER,
      DRAFT_OWNER,
      VOICE_FACADE,
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
    expect([...resolvedDependencies(VOICE_FACADE, { includeTypeOnly: false })]).toEqual(
      expect.arrayContaining([CAPTURE_OWNER, DRAFT_OWNER])
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
      mindroomFile('threads/open/threadOpenCacheController.ts'),
      mindroomFile('threads/open/threadOpenCacheFirst.ts'),
      mindroomFile('threads/open/threadOpenSdkBootstrap.ts'),
      mindroomFile('threads/open/threadOpenTargetEvent.ts'),
      mindroomFile('threads/open/threadOpenSeedController.ts'),
      THREAD_SDK_OWNER,
    ]);
    expect(
      [...resolvedDependencies(TIMELINE, { includeTypeOnly: false })].filter((dependency) =>
        forbiddenParentDependencies.has(dependency)
      )
    ).toEqual([]);

    const forbiddenSessionDependencies = new Set(
      walkProductionSources(mindroomFile('timeline/message-rendering')).concat(TIMELINE)
    );
    expect(dependencyViolations(THREAD_SESSION, forbiddenSessionDependencies)).toEqual([]);
    expect(dependencyViolations(THREAD_PAGINATION, forbiddenSessionDependencies)).toEqual([]);

    const engineDependencies = walkProductionSources(mindroomFile('event-store/engine')).flatMap((file) => [
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

    const oldThreads = new Set(filesMovedFrom('src/app/mindroom/threads/'));
    const threadSources = walkProductionSources(MINDROOM_ROOT).filter((file) => oldThreads.has(file));
    expect(
      memberOwnership(threadSources, new Set(['initialEventsFetched', 'replayEvents']))
    ).toEqual([
      {
        file: 'event-store/sdk/threadBootstrapSdk.ts',
        accesses: [
          { name: 'initialEventsFetched', kind: 'read' },
          { name: 'initialEventsFetched', kind: 'write' },
          { name: 'replayEvents', kind: 'write' },
        ],
      },
    ]);
    expect(
      memberOwnership(
        threadSources,
        new Set([
          'addLiveEvents',
          'partitionThreadedEvents',
          'processAggregatedTimelineEvents',
          'processThreadRoots',
        ])
      ).map((entry) => entry.file)
    ).toEqual(['event-store/sdk/roomTimelineSdk.ts']);
    expect(
      memberOwnership(threadSources, new Set(['addEventsToTimeline'])).map((entry) => entry.file)
    ).toEqual([
      'event-store/sdk/roomTimelineSdk.ts',
      'event-store/sdk/threadBootstrapSdk.ts',
    ]);
  });

  it('keeps browser capture separate from durable voice delivery', () => {
    const directory = createFixtureDirectory();
    const violator = join(directory, 'voice-violator.ts');
    writeFileSync(
      violator,
      "new MediaRecorder(stream); navigator.mediaDevices['getUserMedia']({ audio: true });"
    );
    expect(constructedIdentifiers(violator)).toEqual(['MediaRecorder']);
    expect(memberAccesses(violator).filter((access) => access.name === 'getUserMedia')).toEqual([
      { name: 'getUserMedia', kind: 'call' },
    ]);

    const captureSpecifiers = moduleDependencies(CAPTURE_OWNER).map(
      (dependency) => dependency.specifier
    );
    expect(
      captureSpecifiers.filter(
        (specifier) =>
          specifier === 'react' ||
          specifier.startsWith('react/') ||
          specifier === 'jotai' ||
          specifier.startsWith('jotai/') ||
          specifier === 'matrix-js-sdk' ||
          specifier.startsWith('matrix-js-sdk/') ||
          specifier.includes('roomInputDrafts') ||
          specifier.includes('voiceSendDraftController') ||
          specifier.includes('room-input')
      )
    ).toEqual([]);

    const draftDependencies = moduleDependencies(DRAFT_OWNER);
    expect(
      draftDependencies.filter(
        (dependency) =>
          dependency.specifier.includes('microphoneAccess') ||
          dependency.specifier.includes('voiceRecorderMime') ||
          (dependency.specifier.includes('voiceCaptureSession') && !dependency.typeOnly)
      )
    ).toEqual([]);
    expect(
      memberAccesses(DRAFT_OWNER).filter((access) =>
        ['getUserMedia', 'getTracks', 'stop', 'close', 'disconnect'].includes(access.name)
      )
    ).toEqual([]);
    expect(constructedIdentifiers(DRAFT_OWNER)).not.toContain('MediaRecorder');
    expect(constructedIdentifiers(DRAFT_OWNER)).not.toContain('AudioContext');
  });
});
