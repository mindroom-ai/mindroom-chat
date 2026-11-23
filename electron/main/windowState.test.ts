import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  fitToDisplays,
  loadWindowState,
  saveWindowState,
  windowStatePath,
  type WindowState,
} from './windowState';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-window-state-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const PRIMARY: Electron.Rectangle = { x: 0, y: 25, width: 1440, height: 875 };
const RIGHT_MONITOR: Electron.Rectangle = { x: 1440, y: 0, width: 2560, height: 1400 };
const LEFT_MONITOR: Electron.Rectangle = { x: -1920, y: 0, width: 1920, height: 1080 };

describe('fitToDisplays', () => {
  it('returns undefined for undefined state, invalid numbers, or empty workAreas', () => {
    expect(fitToDisplays(undefined, [PRIMARY])).toBeUndefined();
    expect(
      fitToDisplays({ x: 100, y: 100, width: 1000, height: 700, fullScreen: false }, [])
    ).toBeUndefined();
    expect(
      fitToDisplays({ x: Number.NaN, y: 100, width: 1000, height: 700, fullScreen: false }, [
        PRIMARY,
      ])
    ).toBeUndefined();
    expect(
      fitToDisplays(
        { x: 100, y: Number.POSITIVE_INFINITY, width: 1000, height: 700, fullScreen: false },
        [PRIMARY]
      )
    ).toBeUndefined();
    expect(
      fitToDisplays({ x: 100, y: 100, width: 0, height: 700, fullScreen: false }, [PRIMARY])
    ).toBeUndefined();
    expect(
      fitToDisplays({ x: 100, y: 100, width: 1000, height: -10, fullScreen: false }, [PRIMARY])
    ).toBeUndefined();
  });

  it('keeps valid bounds that already sit inside a display', () => {
    const saved: WindowState = { x: 120, y: 80, width: 1100, height: 720, fullScreen: false };
    expect(fitToDisplays(saved, [PRIMARY])).toEqual(saved);
  });

  it('preserves fullScreen flag when restoring valid normal bounds', () => {
    const saved: WindowState = { x: 120, y: 80, width: 1100, height: 720, fullScreen: true };
    expect(fitToDisplays(saved, [PRIMARY])).toEqual(saved);
  });

  it('returns undefined when saved bounds were on an unplugged display', () => {
    const savedOnRight: WindowState = {
      x: 1600,
      y: 100,
      width: 1200,
      height: 800,
      fullScreen: false,
    };
    expect(fitToDisplays(savedOnRight, [PRIMARY])).toBeUndefined();
  });

  it('returns undefined when overlap is smaller than the minimum visible threshold', () => {
    const barelyPeekingX: WindowState = {
      x: 1350,
      y: 100,
      width: 1200,
      height: 800,
      fullScreen: false,
    };
    // Only 90px wide overlaps PRIMARY (1440 - 1350 = 90 < 100).
    expect(fitToDisplays(barelyPeekingX, [PRIMARY])).toBeUndefined();

    const barelyPeekingY: WindowState = {
      x: 200,
      y: 860,
      width: 800,
      height: 600,
      fullScreen: false,
    };
    // Only 40px tall overlaps PRIMARY (900 - 860 = 40 < 50).
    expect(fitToDisplays(barelyPeekingY, [PRIMARY])).toBeUndefined();
  });

  it('picks the display with the largest intersection and clamps inside it', () => {
    const spanning: WindowState = { x: 1100, y: 100, width: 1200, height: 800, fullScreen: false };
    // Overlaps PRIMARY by 340x800, RIGHT_MONITOR by 860x800 -> picks RIGHT_MONITOR.
    expect(fitToDisplays(spanning, [PRIMARY, RIGHT_MONITOR])).toEqual({
      x: 1440,
      y: 100,
      width: 1200,
      height: 800,
      fullScreen: false,
    });
  });

  it('handles negative-coordinate displays to the left of primary', () => {
    const onLeft: WindowState = { x: -1600, y: 100, width: 1200, height: 800, fullScreen: false };
    expect(fitToDisplays(onLeft, [LEFT_MONITOR, PRIMARY])).toEqual(onLeft);
  });

  it('clamps oversized windows to the display workArea and enforces minimum size', () => {
    const huge: WindowState = { x: -50, y: 0, width: 3000, height: 2000, fullScreen: false };
    expect(fitToDisplays(huge, [PRIMARY])).toEqual({
      x: 0,
      y: 25,
      width: 1440,
      height: 875,
      fullScreen: false,
    });

    const tiny: WindowState = { x: 200, y: 200, width: 200, height: 250, fullScreen: false };
    expect(fitToDisplays(tiny, [PRIMARY])).toEqual({
      x: 200,
      y: 200,
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
      fullScreen: false,
    });
  });

  it('handles workAreas smaller than the minimum window dimensions or overlap thresholds', () => {
    const tinyArea: Electron.Rectangle = { x: 10, y: 20, width: 80, height: 40 };
    const saved: WindowState = { x: 0, y: 0, width: 500, height: 600, fullScreen: false };
    expect(fitToDisplays(saved, [tinyArea])).toEqual({
      x: 10,
      y: 20,
      width: 80,
      height: 40,
      fullScreen: false,
    });
  });
});

describe('loadWindowState / saveWindowState', () => {
  it('saves atomically and loads back valid state', () => {
    const dir = makeTempDir();
    const state: WindowState = { x: 80, y: 60, width: 1024, height: 700, fullScreen: false };
    saveWindowState(dir, state);
    expect(loadWindowState(dir)).toEqual(state);
    expect(fs.readdirSync(dir)).toEqual(['window-state.json']);
  });

  it('returns undefined for missing or corrupt files without throwing', () => {
    const dir = makeTempDir();
    expect(loadWindowState(dir)).toBeUndefined();

    fs.writeFileSync(windowStatePath(dir), '{not valid json', 'utf8');
    expect(loadWindowState(dir)).toBeUndefined();

    fs.writeFileSync(
      windowStatePath(dir),
      JSON.stringify({ x: 10, y: 10, width: 'wide', height: 600, fullScreen: false }),
      'utf8'
    );
    expect(loadWindowState(dir)).toBeUndefined();
  });

  it('never throws when saving to an unwritable path', () => {
    const dir = makeTempDir();
    const fileBlockingDir = path.join(dir, 'not-a-dir');
    fs.writeFileSync(fileBlockingDir, 'x', 'utf8');
    expect(() =>
      saveWindowState(fileBlockingDir, {
        x: 10,
        y: 20,
        width: 800,
        height: 600,
        fullScreen: false,
      })
    ).not.toThrow();
  });
});
