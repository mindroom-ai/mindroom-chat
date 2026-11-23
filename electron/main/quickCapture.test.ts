import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { focus: vi.fn(), hide: vi.fn() },
  BrowserWindow: vi.fn(),
  clipboard: { writeText: vi.fn(() => Promise.resolve()) },
  ipcMain: { handle: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
  screen: { getAllDisplays: vi.fn(() => []) },
}));

import { APP_ORIGIN } from './bundleProtocol';
import { decideToggleAction } from './quickCapture';
import { guardWebContents, isQuickCaptureUrl, setBlockedUrlRecorder } from './security';
import {
  WIDGET_HEIGHT,
  WIDGET_WIDTH,
  fitQuickCaptureToDisplays,
  loadQuickCapturePlace,
  quickCaptureStatePath,
  saveQuickCapturePlace,
  type QuickCapturePlace,
} from './windowState';

const tempDirs: string[] = [];
const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-qc-state-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  setBlockedUrlRecorder(undefined);
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const PRIMARY: Electron.Rectangle = { x: 0, y: 25, width: 1440, height: 875 };
const RIGHT_MONITOR: Electron.Rectangle = { x: 1440, y: 0, width: 2560, height: 1400 };

describe('decideToggleAction', () => {
  it('returns show when hidden, hide when visible and focused, and focus when visible and unfocused', () => {
    expect(decideToggleAction({ visible: false, focused: false })).toBe('show');
    expect(decideToggleAction({ visible: false, focused: true })).toBe('show');
    expect(decideToggleAction({ visible: true, focused: true })).toBe('hide');
    expect(decideToggleAction({ visible: true, focused: false })).toBe('focus');
  });
});

describe('isQuickCaptureUrl & guardWebContents', () => {
  it('allows only /quick-capture and /quick-capture/ on the app origin', () => {
    expect(isQuickCaptureUrl(`${APP_ORIGIN}/quick-capture/`)).toBe(true);
    expect(isQuickCaptureUrl(`${APP_ORIGIN}/quick-capture`)).toBe(true);
    expect(isQuickCaptureUrl(`${APP_ORIGIN}/quick-capture/?tab=1#top`)).toBe(true);

    expect(isQuickCaptureUrl(`${APP_ORIGIN}/`)).toBe(false);
    expect(isQuickCaptureUrl(`${APP_ORIGIN}/index`)).toBe(false);
    expect(isQuickCaptureUrl(`${APP_ORIGIN}/quick-capture/other`)).toBe(false);
    expect(isQuickCaptureUrl(`${APP_ORIGIN}/canvas-frame.html`)).toBe(false);
    expect(isQuickCaptureUrl('https://example.com/quick-capture/')).toBe(false);
    expect(isQuickCaptureUrl('capacitor://other/quick-capture/')).toBe(false);
  });

  it('pins navigation to /quick-capture/ and records blocked navigations', () => {
    const blocked: string[] = [];
    setBlockedUrlRecorder((url) => blocked.push(url));

    const emitter = new EventEmitter();
    const contents = Object.assign(emitter, {
      setWindowOpenHandler: vi.fn(),
    }) as unknown as Electron.WebContents;
    guardWebContents(contents, isQuickCaptureUrl);

    const allowEvent = { preventDefault: vi.fn() };
    emitter.emit('will-navigate', allowEvent, `${APP_ORIGIN}/quick-capture/`);
    expect(allowEvent.preventDefault).not.toHaveBeenCalled();

    const denyEvent = { preventDefault: vi.fn() };
    emitter.emit('will-navigate', denyEvent, `${APP_ORIGIN}/`);
    expect(denyEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(blocked).toEqual([`${APP_ORIGIN}/`]);
  });
});

describe('fitQuickCaptureToDisplays & persistence', () => {
  it('keeps valid places inside a display and clamps overlapping edges', () => {
    expect(fitQuickCaptureToDisplays({ x: 200, y: 120 }, [PRIMARY])).toEqual({ x: 200, y: 120 });

    // Clamps inside primary workArea respecting WIDGET_WIDTH x WIDGET_HEIGHT.
    expect(fitQuickCaptureToDisplays({ x: -50, y: 0 }, [PRIMARY])).toEqual({ x: 0, y: 25 });
    expect(fitQuickCaptureToDisplays({ x: 1200, y: 700 }, [PRIMARY])).toEqual({
      x: PRIMARY.width - WIDGET_WIDTH,
      y: PRIMARY.y + PRIMARY.height - WIDGET_HEIGHT,
    });

    // Picks the display with larger intersection.
    expect(fitQuickCaptureToDisplays({ x: 1300, y: 100 }, [PRIMARY, RIGHT_MONITOR])).toEqual({
      x: RIGHT_MONITOR.x,
      y: 100,
    });
  });

  it('rejects undefined, non-finite numbers, unplugged displays, and tiny overlaps', () => {
    expect(fitQuickCaptureToDisplays(undefined, [PRIMARY])).toBeUndefined();
    expect(fitQuickCaptureToDisplays({ x: 100, y: 100 }, [])).toBeUndefined();
    expect(fitQuickCaptureToDisplays({ x: Number.NaN, y: 100 }, [PRIMARY])).toBeUndefined();
    expect(
      fitQuickCaptureToDisplays({ x: 100, y: Number.POSITIVE_INFINITY }, [PRIMARY])
    ).toBeUndefined();

    // Unplugged secondary display.
    expect(fitQuickCaptureToDisplays({ x: 1800, y: 100 }, [PRIMARY])).toBeUndefined();

    // Less than 100px horizontal or 50px vertical overlap.
    expect(fitQuickCaptureToDisplays({ x: 1350, y: 100 }, [PRIMARY])).toBeUndefined();
    expect(fitQuickCaptureToDisplays({ x: 200, y: 860 }, [PRIMARY])).toBeUndefined();
  });

  it('round-trips Quick Capture place in quick-capture-state.json and ignores corrupt files', () => {
    const dir = makeTempDir();
    expect(loadQuickCapturePlace(dir)).toBeUndefined();

    const place: QuickCapturePlace = { x: 420, y: 180 };
    saveQuickCapturePlace(dir, place);
    expect(loadQuickCapturePlace(dir)).toEqual(place);
    expect(fs.readdirSync(dir)).toEqual(['quick-capture-state.json']);

    fs.writeFileSync(quickCaptureStatePath(dir), '{broken', 'utf8');
    expect(loadQuickCapturePlace(dir)).toBeUndefined();

    fs.writeFileSync(quickCaptureStatePath(dir), JSON.stringify({ x: 'bad', y: 10 }), 'utf8');
    expect(loadQuickCapturePlace(dir)).toBeUndefined();
  });
});
