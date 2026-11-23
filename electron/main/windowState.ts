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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFiniteRect = (rect: { x: unknown; y: unknown; width: unknown; height: unknown }): boolean =>
  isFiniteNumber(rect.x) &&
  isFiniteNumber(rect.y) &&
  isFiniteNumber(rect.width) &&
  isFiniteNumber(rect.height) &&
  rect.width > 0 &&
  rect.height > 0;

const isValidWindowState = (value: unknown): value is WindowState =>
  isRecord(value) &&
  isFiniteRect({ x: value.x, y: value.y, width: value.width, height: value.height }) &&
  typeof value.fullScreen === 'boolean';

const isValidQuickCapturePlace = (value: unknown): value is QuickCapturePlace =>
  isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);

const clamp = (value: number, min: number, max: number): number =>
  Math.round(Math.min(max, Math.max(min, value)));

const findBestDisplay = (
  rect: Electron.Rectangle,
  workAreas: Electron.Rectangle[]
): Electron.Rectangle | undefined => {
  let bestArea: Electron.Rectangle | undefined;
  let bestIntersection = 0;

  for (const area of workAreas) {
    if (!isFiniteRect(area)) continue;
    const overlapWidth = Math.max(
      0,
      Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x)
    );
    const overlapHeight = Math.max(
      0,
      Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y)
    );
    if (
      overlapWidth < Math.min(MIN_VISIBLE_WIDTH, area.width) ||
      overlapHeight < Math.min(MIN_VISIBLE_HEIGHT, area.height)
    ) {
      continue;
    }
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

  const width = clamp(state.width, Math.min(MIN_WIDTH, bestArea.width), bestArea.width);
  const height = clamp(state.height, Math.min(MIN_HEIGHT, bestArea.height), bestArea.height);
  const x = clamp(state.x, bestArea.x, bestArea.x + bestArea.width - width);
  const y = clamp(state.y, bestArea.y, bestArea.y + bestArea.height - height);
  return { x, y, width, height, fullScreen: state.fullScreen };
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

  const x = clamp(
    place.x,
    bestArea.x,
    Math.max(bestArea.x, bestArea.x + bestArea.width - WIDGET_WIDTH)
  );
  const y = clamp(
    place.y,
    bestArea.y,
    Math.max(bestArea.y, bestArea.y + bestArea.height - WIDGET_HEIGHT)
  );
  return { x, y };
};

const loadJson = <T>(target: string, isValid: (value: unknown) => value is T): T | undefined => {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(target, 'utf8'));
    return isValid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const writeJsonAtomic = (target: string, data: unknown): void => {
  const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
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

export const loadWindowState = (userDataDir: string): WindowState | undefined =>
  loadJson(windowStatePath(userDataDir), isValidWindowState);

export const saveWindowState = (userDataDir: string, state: WindowState): void => {
  if (isValidWindowState(state)) writeJsonAtomic(windowStatePath(userDataDir), state);
};

export const quickCaptureStatePath = (userDataDir: string): string =>
  path.join(userDataDir, QUICK_CAPTURE_STATE_FILENAME);

export const loadQuickCapturePlace = (userDataDir: string): QuickCapturePlace | undefined =>
  loadJson(quickCaptureStatePath(userDataDir), isValidQuickCapturePlace);

export const saveQuickCapturePlace = (userDataDir: string, place: QuickCapturePlace): void => {
  if (isValidQuickCapturePlace(place)) writeJsonAtomic(quickCaptureStatePath(userDataDir), place);
};
