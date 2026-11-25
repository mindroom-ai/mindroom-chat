import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAllConsent,
  clearControllerConsent,
  consentFilePath,
  emptyConsent,
  isControllerFullAccess,
  loadConsent,
  saveConsent,
  setControllerFullAccess,
} from './desktopAccessConsent';

const tempDirs: string[] = [];
const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-consent-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('desktopAccessConsent', () => {
  it('returns empty consent when the file is missing', () => {
    const dir = makeTempDir();
    expect(loadConsent(dir)).toEqual(emptyConsent());
    expect(isControllerFullAccess(loadConsent(dir), 'ctrl-1')).toBe(false);
  });

  it('writes atomically with mode 0600 and persists per-controller grants and login item state', () => {
    const dir = makeTempDir();
    const saved = setControllerFullAccess(dir, 'ctrl-1', {
      agentName: 'General',
      managedLoginItem: true,
      now: 1_700_000_000_000,
    });

    expect(saved).toEqual({
      v: 1,
      managedLoginItem: true,
      controllers: {
        'ctrl-1': { mode: 'full', grantedAt: 1_700_000_000_000, agentName: 'General' },
      },
    });
    expect(loadConsent(dir)).toEqual(saved);
    expect(isControllerFullAccess(saved, 'ctrl-1')).toBe(true);
    expect(isControllerFullAccess(saved, 'ctrl-2')).toBe(false);

    const filePath = consentFilePath(dir);
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir)).toEqual(['desktop-access-consent.json']);

    const afterSecond = setControllerFullAccess(dir, 'ctrl-2', {
      agentName: 'Code',
      now: 1_700_000_001_000,
    });
    expect(afterSecond.managedLoginItem).toBe(true);
    expect(isControllerFullAccess(afterSecond, 'ctrl-1')).toBe(true);
    expect(isControllerFullAccess(afterSecond, 'ctrl-2')).toBe(true);

    const afterClearOne = clearControllerConsent(dir, 'ctrl-1');
    expect(isControllerFullAccess(afterClearOne, 'ctrl-1')).toBe(false);
    expect(isControllerFullAccess(afterClearOne, 'ctrl-2')).toBe(true);

    const { previous, current } = clearAllConsent(dir);
    expect(previous.managedLoginItem).toBe(true);
    expect(current).toEqual(emptyConsent());
    expect(loadConsent(dir)).toEqual(emptyConsent());
  });

  it('fails closed to empty consent on corrupt, invalid, or symlinked files', () => {
    const dir = makeTempDir();
    const target = consentFilePath(dir);

    fs.writeFileSync(target, '{not json', 'utf8');
    expect(loadConsent(dir)).toEqual(emptyConsent());

    fs.writeFileSync(
      target,
      JSON.stringify({ v: 2, managedLoginItem: false, controllers: {} }),
      'utf8'
    );
    expect(loadConsent(dir)).toEqual(emptyConsent());

    fs.writeFileSync(
      target,
      JSON.stringify({
        v: 1,
        managedLoginItem: false,
        controllers: { 'ctrl-1': { mode: 'restricted', grantedAt: 123 } },
      }),
      'utf8'
    );
    expect(loadConsent(dir)).toEqual(emptyConsent());

    fs.writeFileSync(
      target,
      '{"v":1,"managedLoginItem":false,"controllers":{"__proto__":{"mode":"full","grantedAt":1}}}',
      'utf8'
    );
    expect(loadConsent(dir)).toEqual(emptyConsent());

    const outside = path.join(dir, 'outside.json');
    saveConsent(dir, {
      v: 1,
      managedLoginItem: false,
      controllers: { 'ctrl-1': { mode: 'full', grantedAt: 100 } },
    });
    fs.renameSync(target, outside);
    fs.symlinkSync(outside, target);
    expect(loadConsent(dir)).toEqual(emptyConsent());
  });
});
