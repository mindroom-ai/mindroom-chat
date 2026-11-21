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
const LIVE_OWNER = appFile('composer/voice/liveVoiceRecording.ts');
const DRAFT_OWNER = appFile('composer/voice/voiceSendDraftController.ts');
const VOICE_FACADE = appFile('composer/voice/useVoiceRecorder.ts');

const fixtureDirectories: string[] = [];
const createFixtureDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'guards-voice-ownership-'));
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
const composerDependencies = (path: string): string[] =>
  [...resolvedDependencies(path)]
    .map(appRelativePath)
    .filter(
      (dependency) =>
        dependency.startsWith('composer/') && !dependency.startsWith('composer/voice/')
    );

describe('voice recorder ownership architecture', () => {
  it('requires the voice owners and composes them in the recorder hook', () => {
    const owners = [CAPTURE_OWNER, LIVE_OWNER, DRAFT_OWNER, VOICE_FACADE];
    expect(owners.filter((path) => !pathExists(path))).toEqual([]);
    // The hook shows the account's recording and delivers the one its composer claims; it makes
    // no capture session of its own (below).
    expect([...resolvedDependencies(VOICE_FACADE, { includeTypeOnly: false })]).toEqual(
      expect.arrayContaining([LIVE_OWNER, DRAFT_OWNER])
    );
  });

  it('gives the live recording one owner, which knows no destination', () => {
    // The account owns the live recording; the composer whose Send is pressed owns its delivery.
    // So no composer makes a capture session: one would end with it.
    // Named at all, so a session handed to `useState` as an initialiser counts too.
    expect(
      walkProductionSources(APP_ROOT)
        .filter((path) => readSource(path).includes('createVoiceCaptureSession'))
        .map(appRelativePath)
        .sort()
    ).toEqual([
      'composer/voice/startLiveVoiceRecording.ts',
      'composer/voice/voiceCaptureSession.ts',
    ]);
    // The owner makes the session it is handed by that one start module.
    expect(
      walkProductionSources(APP_ROOT)
        .filter((path) => readSource(path).includes('beginLiveVoiceRecording'))
        .map(appRelativePath)
        .sort()
    ).toEqual([
      'composer/voice/liveVoiceRecording.ts',
      'composer/voice/startLiveVoiceRecording.ts',
    ]);

    // Capture and jotai only: no room, thread, draft, Matrix type or React. Capture by its types
    // alone, so the shell, which loads the owner at once, loads no capture code.
    expect(
      moduleDependencies(LIVE_OWNER).map(({ specifier, typeOnly }) => ({ specifier, typeOnly }))
    ).toEqual([
      { specifier: 'jotai', typeOnly: false },
      { specifier: './voiceCaptureSession', typeOnly: true },
    ]);
    expect([...resolvedDependencies(LIVE_OWNER)].map(appRelativePath)).toEqual([
      'composer/voice/voiceCaptureSession.ts',
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
          specifier.includes('voiceSendDraftController')
      )
    ).toEqual([]);
    // The rest of the composer (its drafts, send session and input) sits in composer/, around
    // voice/: durable delivery reaches the drafts there, browser capture reaches none of it.
    expect(composerDependencies(DRAFT_OWNER)).toContain('composer/roomInputDrafts.ts');
    expect(composerDependencies(CAPTURE_OWNER)).toEqual([]);

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
