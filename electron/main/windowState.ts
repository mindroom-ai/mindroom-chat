import fs from 'node:fs';
import path from 'node:path';

export const MIN_WIDTH = 400;
export const MIN_HEIGHT = 500;
export const WIDGET_WIDTH = 360;
export const WIDGET_HEIGHT = 460;

const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 50;
const STATE_FILENAME = 'window-state.json';
const QUICK_CAPTURE_STATE_FILENAME = 'quick-capture-state.json';

export type WindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  fullScreen: boolean;
};

export type QuickCapturePlace = {
  x: number;
  y: number;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isFiniteRect = (rect: { x: unknown; y: unknown; width: unknown; height: unknown }): boolean =>
  isFiniteNumber(rect.x) &&
  isFiniteNumber(rect.y) &&
  isFiniteNumber(rect.width) &&
  isFiniteNumber(rect.height) &&
  rect.width > 0 &&
  rect.height > 0;

const isValidWindowState = (value: unknown): value is WindowState => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isFiniteRect({
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
    }) && typeof candidate.fullScreen === 'boolean'
  );
};

const isValidQuickCapturePlace = (value: unknown): value is QuickCapturePlace => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isFiniteNumber(candidate.x) && isFiniteNumber(candidate.y);
};

const findBestDisplay = (
  rect: Electron.Rectangle,
  workAreas: Electron.Rectangle[]
): Electron.Rectangle | undefined => {
  let bestArea: Electron.Rectangle | undefined;
  let bestIntersection = 0;

  for (const area of workAreas) {
    if (!isFiniteRect(area)) continue;
    const left = Math.max(rect.x, area.x);
    const right = Math.min(rect.x + rect.width, area.x + area.width);
    const top = Math.max(rect.y, area.y);
    const bottom = Math.min(rect.y + rect.height, area.y + area.height);
    const overlapWidth = Math.max(0, right - left);
    const overlapHeight = Math.max(0, bottom - top);
    const requiredWidth = Math.min(MIN_VISIBLE_WIDTH, area.width);
    const requiredHeight = Math.min(MIN_VISIBLE_HEIGHT, area.height);
    if (overlapWidth < requiredWidth || overlapHeight < requiredHeight) continue;
    const intersection = overlapWidth * overlapHeight;
    if (intersection > bestIntersection) {
      bestIntersection = intersection;
      bestArea = area;
    }
  }

  return bestArea;
};

export const fitToDisplays = (
  state: WindowState | undefined,
  workAreas: Electron.Rectangle[]
): WindowState | undefined => {
  if (!isValidWindowState(state) || workAreas.length === 0) return undefined;

  const bestArea = findBestDisplay(state, workAreas);
  if (!bestArea) return undefined;

  const minWidth = Math.min(MIN_WIDTH, bestArea.width);
  const minHeight = Math.min(MIN_HEIGHT, bestArea.height);
  const width = Math.round(Math.min(bestArea.width, Math.max(minWidth, state.width)));
  const height = Math.round(Math.min(bestArea.height, Math.max(minHeight, state.height)));
  const maxX = bestArea.x + bestArea.width - width;
  const maxY = bestArea.y + bestArea.height - height;
  const x = Math.round(Math.min(maxX, Math.max(bestArea.x, state.x)));
  const y = Math.round(Math.min(maxY, Math.max(bestArea.y, state.y)));

  return {
    x,
    y,
    width,
    height,
    fullScreen: state.fullScreen,
  };
};

export const fitQuickCaptureToDisplays = (
  place: QuickCapturePlace | undefined,
  workAreas: Electron.Rectangle[]
): QuickCapturePlace | undefined => {
  if (!isValidQuickCapturePlace(place) || workAreas.length === 0) return undefined;

  const bestArea = findBestDisplay(
    { x: place.x, y: place.y, width: WIDGET_WIDTH, height: WIDGET_HEIGHT },
    workAreas
  );
  if (!bestArea) return undefined;

  const maxX = Math.max(bestArea.x, bestArea.x + bestArea.width - WIDGET_WIDTH);
  const maxY = Math.max(bestArea.y, bestArea.y + bestArea.height - WIDGET_HEIGHT);
  const x = Math.round(Math.min(maxX, Math.max(bestArea.x, place.x)));
  const y = Math.round(Math.min(maxY, Math.max(bestArea.y, place.y)));
  return { x, y };
};

const readJsonFile = (target: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return undefined;
  }
};

const writeJsonAtomic = (userDataDir: string, target: string, data: unknown): void => {
  const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(data), 'utf8');
    fs.renameSync(temp, target);
  } catch {
    try {
      fs.unlinkSync(temp);
    } catch {
      // Ignore cleanup errors.
    }
  }
};

export const windowStatePath = (userDataDir: string): string =>
  path.join(userDataDir, STATE_FILENAME);

export const loadWindowState = (userDataDir: string): WindowState | undefined => {
  const parsed = readJsonFile(windowStatePath(userDataDir));
  return isValidWindowState(parsed) ? parsed : undefined;
};

export const saveWindowState = (userDataDir: string, state: WindowState): void => {
  if (!isValidWindowState(state)) return;
  writeJsonAtomic(userDataDir, windowStatePath(userDataDir), state);
};

export const quickCaptureStatePath = (userDataDir: string): string =>
  path.join(userDataDir, QUICK_CAPTURE_STATE_FILENAME);

export const loadQuickCapturePlace = (userDataDir: string): QuickCapturePlace | undefined => {
  const parsed = readJsonFile(quickCaptureStatePath(userDataDir));
  return isValidQuickCapturePlace(parsed) ? parsed : undefined;
};

export const saveQuickCapturePlace = (userDataDir: string, place: QuickCapturePlace): void => {
  if (!isValidQuickCapturePlace(place)) return;
  writeJsonAtomic(userDataDir, quickCaptureStatePath(userDataDir), place);
};
