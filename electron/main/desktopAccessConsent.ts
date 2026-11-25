import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DesktopAccessConsentRecord } from '../../src/app/lib/desktopBridge';

const CONSENT_FILENAME = 'desktop-access-consent.json';
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export type DesktopAccessConsentStore = {
  v: 1;
  managedLoginItem: boolean;
  controllers: Record<string, DesktopAccessConsentRecord>;
};

export const consentFilePath = (userDataDir: string): string =>
  path.join(userDataDir, CONSENT_FILENAME);

export const emptyConsent = (): DesktopAccessConsentStore => ({
  v: 1,
  managedLoginItem: false,
  controllers: {},
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRecord = (value: unknown): DesktopAccessConsentRecord | undefined => {
  if (!isPlainObject(value)) return undefined;
  const { mode, grantedAt, agentName } = value;
  if (mode !== 'full' || typeof grantedAt !== 'number' || !Number.isFinite(grantedAt)) {
    return undefined;
  }
  if (agentName !== undefined && (typeof agentName !== 'string' || !agentName.trim())) {
    return undefined;
  }
  return agentName !== undefined
    ? { mode: 'full', grantedAt, agentName }
    : { mode: 'full', grantedAt };
};

const parseStore = (value: unknown): DesktopAccessConsentStore | undefined => {
  if (!isPlainObject(value)) return undefined;
  if (value.v !== 1 || typeof value.managedLoginItem !== 'boolean') return undefined;
  if (!isPlainObject(value.controllers)) return undefined;
  const controllers: Record<string, DesktopAccessConsentRecord> = {};
  for (const key of Object.keys(value.controllers)) {
    if (!key.trim() || FORBIDDEN_KEYS.has(key)) return undefined;
    const record = parseRecord(value.controllers[key]);
    if (!record) return undefined;
    controllers[key] = record;
  }
  return {
    v: 1,
    managedLoginItem: value.managedLoginItem,
    controllers,
  };
};

export const loadConsent = (userDataDir: string): DesktopAccessConsentStore => {
  const target = consentFilePath(userDataDir);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile()) return emptyConsent();
    const parsed: unknown = JSON.parse(fs.readFileSync(target, 'utf8'));
    return parseStore(parsed) ?? emptyConsent();
  } catch {
    return emptyConsent();
  }
};

export const saveConsent = (userDataDir: string, store: DesktopAccessConsentStore): void => {
  const validated = parseStore(store);
  if (!validated) {
    throw new Error('Refusing to save invalid desktop access consent store.');
  }
  const target = consentFilePath(userDataDir);
  const temp = `${target}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.writeFileSync(temp, JSON.stringify(validated, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, target);
  } catch (error) {
    try {
      fs.unlinkSync(temp);
    } catch {
      // Ignore temp cleanup errors.
    }
    throw error;
  }
};

export const isControllerFullAccess = (
  store: DesktopAccessConsentStore,
  controllerKey: string
): boolean =>
  !FORBIDDEN_KEYS.has(controllerKey) &&
  Object.prototype.hasOwnProperty.call(store.controllers, controllerKey) &&
  store.controllers[controllerKey]?.mode === 'full';

export const setControllerFullAccess = (
  userDataDir: string,
  controllerKey: string,
  options?: { agentName?: string; managedLoginItem?: boolean; now?: number }
): DesktopAccessConsentStore => {
  if (!controllerKey.trim() || FORBIDDEN_KEYS.has(controllerKey)) {
    throw new Error('Invalid controller key for Full Access consent.');
  }
  const current = loadConsent(userDataDir);
  const record: DesktopAccessConsentRecord = {
    mode: 'full',
    grantedAt: options?.now ?? Date.now(),
    ...(options?.agentName?.trim() ? { agentName: options.agentName.trim() } : {}),
  };
  const next: DesktopAccessConsentStore = {
    v: 1,
    managedLoginItem: options?.managedLoginItem ?? current.managedLoginItem,
    controllers: { ...current.controllers, [controllerKey]: record },
  };
  saveConsent(userDataDir, next);
  return next;
};

export const setManagedLoginItem = (
  userDataDir: string,
  managedLoginItem: boolean
): DesktopAccessConsentStore => {
  const current = loadConsent(userDataDir);
  const next: DesktopAccessConsentStore = { ...current, managedLoginItem };
  saveConsent(userDataDir, next);
  return next;
};

export const clearControllerConsent = (
  userDataDir: string,
  controllerKey: string
): DesktopAccessConsentStore => {
  const current = loadConsent(userDataDir);
  if (!Object.prototype.hasOwnProperty.call(current.controllers, controllerKey)) {
    return current;
  }
  const nextControllers: Record<string, DesktopAccessConsentRecord> = {};
  for (const [key, value] of Object.entries(current.controllers)) {
    if (key !== controllerKey) nextControllers[key] = value;
  }
  const next: DesktopAccessConsentStore = {
    v: 1,
    managedLoginItem: current.managedLoginItem,
    controllers: nextControllers,
  };
  saveConsent(userDataDir, next);
  return next;
};

export const clearAllConsent = (
  userDataDir: string
): { previous: DesktopAccessConsentStore; current: DesktopAccessConsentStore } => {
  const previous = loadConsent(userDataDir);
  const current = emptyConsent();
  saveConsent(userDataDir, current);
  return { previous, current };
};
