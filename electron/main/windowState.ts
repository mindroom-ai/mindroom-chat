import fs from 'node:fs';
import path from 'node:path';

export const MIN_WIDTH = 400;
export const MIN_HEIGHT = 500;

const MIN_VISIBLE_WIDTH = 100;
const MIN_VISIBLE_HEIGHT = 50;
const STATE_FILENAME = 'window-state.json';

export type WindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  fullScreen: boolean;
};

const isFiniteRect = (rect: { x: unknown; y: unknown; width: unknown; height: unknown }): boolean =>
  typeof rect.x === 'number' &&
  typeof rect.y === 'number' &&
  typeof rect.width === 'number' &&
  typeof rect.height === 'number' &&
  Number.isFinite(rect.x) &&
  Number.isFinite(rect.y) &&
  Number.isFinite(rect.width) &&
  Number.isFinite(rect.height) &&
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

export const fitToDisplays = (
  state: WindowState | undefined,
  workAreas: Electron.Rectangle[]
): WindowState | undefined => {
  if (!isValidWindowState(state) || workAreas.length === 0) return undefined;

  let bestArea: Electron.Rectangle | undefined;
  let bestIntersection = 0;

  for (const area of workAreas) {
    if (!isFiniteRect(area)) continue;
    const left = Math.max(state.x, area.x);
    const right = Math.min(state.x + state.width, area.x + area.width);
    const top = Math.max(state.y, area.y);
    const bottom = Math.min(state.y + state.height, area.y + area.height);
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

export const windowStatePath = (userDataDir: string): string =>
  path.join(userDataDir, STATE_FILENAME);

export const loadWindowState = (userDataDir: string): WindowState | undefined => {
  try {
    const raw = fs.readFileSync(windowStatePath(userDataDir), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return isValidWindowState(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const saveWindowState = (userDataDir: string, state: WindowState): void => {
  if (!isValidWindowState(state)) return;
  const target = windowStatePath(userDataDir);
  const temp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(state), 'utf8');
    fs.renameSync(temp, target);
  } catch {
    try {
      fs.unlinkSync(temp);
    } catch {
      // Ignore cleanup errors.
    }
  }
};
