import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_ROOT,
  appFile,
  appRelativePath,
  memberAccesses,
  moduleDependencies,
  parseSourceFile,
  pathExists,
  readSource,
  resolvedDependencies,
  walkProductionSources,
} from '../../../../test/architecture';

const CAPTURE_OWNER = appFile('composer/voice/voiceCaptureSession.ts');
const DICTATION_SESSION = appFile('composer/dictation/dictationSession.ts');
const LIVE_OWNER = appFile('composer/capture/liveCapture.ts');
const NON_UI_FEATURES = appFile('shell/ClientNonUIFeatures.tsx');
const CAPTURE_JOURNAL = appFile('composer/capture/captureJournal.ts');
const CAPTURE_INDICATOR = appFile('composer/capture/LiveCaptureIndicator.tsx');
const DRAFT_OWNER = appFile('composer/voice/voiceSendDraftController.ts');
const VOICE_FACADE = appFile('composer/voice/useVoiceRecorder.ts');

const fixtureDirectories: string[] = [];
const createFixtureDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'guards-capture-ownership-'));
  fixtureDirectories.push(directory);
  return directory;
};

afterEach(() => {
  fixtureDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true }));
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

/** The composer modules outside `composer/voice/` that a file imports, type-only imports included. */
const composerDependenciesOutsideVoice = (path: string): string[] =>
  [...resolvedDependencies(path)]
    .map(appRelativePath)
    .filter(
      (dependency) =>
        dependency.startsWith('composer/') && !dependency.startsWith('composer/voice/')
    );

describe('shared live capture and voice ownership architecture', () => {
  it('requires the capture and voice owners and composes them in the recorder hook', () => {
    const owners = [
      CAPTURE_OWNER,
      LIVE_OWNER,
      CAPTURE_JOURNAL,
      CAPTURE_INDICATOR,
      DRAFT_OWNER,
      VOICE_FACADE,
    ];
    expect(owners.filter((path) => !pathExists(path))).toEqual([]);
    // The hook shows the account's live recording and delivers the one its composer claims; it
    // makes no capture session of its own (below).
    expect([...resolvedDependencies(VOICE_FACADE, { includeTypeOnly: false })]).toEqual(
      expect.arrayContaining([LIVE_OWNER, DRAFT_OWNER])
    );
  });

  it('gives live capture one owner with a hard shell bundle-split boundary', () => {
    // No composer creates a voice capture session directly: only the dedicated start module does.
    expect(
      walkProductionSources(APP_ROOT)
        .filter((path) => readSource(path).includes('createVoiceCaptureSession'))
        .map(appRelativePath)
        .sort()
    ).toEqual([
      'composer/voice/startLiveVoiceRecording.ts',
      'composer/voice/voiceCaptureSession.ts',
    ]);
    // No composer creates a dictation session directly: only the dedicated start module does.
    expect(
      walkProductionSources(APP_ROOT)
        .filter((path) => readSource(path).includes('createDictationSession'))
        .map(appRelativePath)
        .sort()
    ).toEqual([
      'composer/dictation/dictationSession.ts',
      'composer/dictation/startLiveDictation.ts',
    ]);
    // Only the live capture owner and start modules call beginLiveCapture or restoreLiveCapture.
    const allowedLiveStarters = [
      'composer/capture/liveCapture.ts',
      'composer/dictation/startLiveDictation.ts',
      'composer/voice/startLiveVoiceRecording.ts',
    ];
    expect(
      walkProductionSources(APP_ROOT)
        .filter((path) => readSource(path).includes('beginLiveCapture'))
        .map(appRelativePath)
        .sort()
    ).toEqual(allowedLiveStarters);
    const restoreCallers = walkProductionSources(APP_ROOT)
      .filter((path) => readSource(path).includes('restoreLiveCapture'))
      .map(appRelativePath)
      .sort();
    expect(restoreCallers).toEqual([
      'composer/capture/liveCapture.ts',
      'composer/dictation/startLiveDictation.ts',
    ]);
    expect(restoreCallers.every((path) => allowedLiveStarters.includes(path))).toBe(true);

    // Runtime import is jotai ONLY; capture sessions are import type only so the initial shell
    // bundle loads zero MediaRecorder, AudioWorklet, Silero VAD, idb, or MatrixClient code.
    expect(
      moduleDependencies(LIVE_OWNER).map(({ specifier, typeOnly }) => ({ specifier, typeOnly }))
    ).toEqual([
      { specifier: 'jotai', typeOnly: false },
      { specifier: '../dictation/dictationSession', typeOnly: true },
      { specifier: '../voice/voiceCaptureSession', typeOnly: true },
    ]);
    expect([...resolvedDependencies(LIVE_OWNER, { includeTypeOnly: false })]).toEqual([]);
    expect([...resolvedDependencies(LIVE_OWNER)].map(appRelativePath).sort()).toEqual([
      'composer/dictation/dictationSession.ts',
      'composer/voice/voiceCaptureSession.ts',
    ]);
  }, 15_000);

  it('keeps LiveCaptureIndicator and captureJournal free of capture engine runtime deps', () => {
    const indicatorRuntimeLocal = [
      ...resolvedDependencies(CAPTURE_INDICATOR, { includeTypeOnly: false }),
    ].map(appRelativePath);
    const forbiddenIndicatorDeps = [
      'composer/voice/useVoiceRecorder.ts',
      'composer/voice/voiceCaptureSession.ts',
      'composer/voice/startLiveVoiceRecording.ts',
      'composer/capture/captureJournal.ts',
      'composer/dictation/dictationSession.ts',
      'composer/dictation/dictationAudioCapture.ts',
      'composer/dictation/sileroVad.ts',
    ];
    expect(indicatorRuntimeLocal.filter((dep) => forbiddenIndicatorDeps.includes(dep))).toEqual([]);

    const indicatorRuntimeSpecifiers = moduleDependencies(CAPTURE_INDICATOR)
      .filter((dep) => !dep.typeOnly)
      .map((dep) => dep.specifier);
    expect(
      indicatorRuntimeSpecifiers.filter(
        (specifier) =>
          specifier === 'idb' ||
          specifier === 'matrix-js-sdk' ||
          specifier.startsWith('matrix-js-sdk/')
      )
    ).toEqual([]);

    const journalRuntimeLocal = [
      ...resolvedDependencies(CAPTURE_JOURNAL, { includeTypeOnly: false }),
    ].map(appRelativePath);
    expect(journalRuntimeLocal).toEqual(['composer/voice/voiceRecorderMime.ts']);

    // ClientNonUIFeatures checks IDB existence cheaply and only lazy-imports dictation recovery.
    const nonUiStaticSpecifiers = moduleDependencies(NON_UI_FEATURES)
      .filter((dep) => dep.kind === 'import' && !dep.typeOnly)
      .map((dep) => dep.specifier);
    expect(
      nonUiStaticSpecifiers.filter(
        (specifier) =>
          specifier.includes('startLiveDictation') ||
          specifier.includes('dictationSession') ||
          specifier.includes('dictationAudioCapture') ||
          specifier.includes('sileroVad') ||
          specifier.includes('voiceCaptureSession')
      )
    ).toEqual([]);
  });

  it('keeps dictationSession free of UI, Jotai, Matrix, Slate, and draft dependencies', () => {
    const dictationSpecifiers = moduleDependencies(DICTATION_SESSION).map(
      (dependency) => dependency.specifier
    );
    expect(
      dictationSpecifiers.filter(
        (specifier) =>
          specifier === 'react' ||
          specifier.startsWith('react/') ||
          specifier === 'jotai' ||
          specifier.startsWith('jotai/') ||
          specifier === 'matrix-js-sdk' ||
          specifier.startsWith('matrix-js-sdk/') ||
          specifier === 'slate' ||
          specifier.startsWith('slate/') ||
          specifier.includes('roomInputDrafts')
      )
    ).toEqual([]);
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
          specifier.includes('voiceSendDraftController')
      )
    ).toEqual([]);
    // Durable delivery reaches composer drafts and journal; browser capture reaches none of it.
    expect(composerDependenciesOutsideVoice(DRAFT_OWNER)).toContain('composer/roomInputDrafts.ts');
    expect(composerDependenciesOutsideVoice(CAPTURE_OWNER)).toEqual([]);

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
  }, 15_000);
});
