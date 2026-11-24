import { isRecord } from '../lib/isRecord';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  removeStorageItemSafe,
  setStorageItemSafe,
} from '../lib/safeLocalStorage';
import { modelCatalogStorageKey } from '../preferences/accountStorageKeys';
import type { ModelRuntime } from '../matrix/runtimeDeviceTrust';
import { parseModelCatalogPayload, type ModelCatalogResponse } from './modelProtocol';

/** Display data only. A thread's own verified answer supplies the runtime for commands. */
export type RoomCatalog = {
  runtime: ModelRuntime;
  models: ModelCatalogResponse['models'];
  agentUserIds: string[];
  supportsRootModel?: true;
  inherited: ModelCatalogResponse['selection']['inherited'];
};
export const ROOM_CATALOG_LIMIT = 64;
const STORAGE_VERSION = 1;
// At most 512 KiB as UTF-16, leaving most of the shared origin quota for other features.
const STORAGE_CHAR_LIMIT = 256 * 1024;

const parseRoomCatalog = (value: unknown): RoomCatalog | undefined => {
  if (!isRecord(value) || !isRecord(value.runtime)) return undefined;
  const { userId, deviceId, curveKey } = value.runtime;
  if (typeof userId !== 'string' || typeof deviceId !== 'string' || typeof curveKey !== 'string')
    return undefined;
  if (!userId.startsWith('@') || userId.length > 1024) return undefined;
  if (!deviceId || deviceId.length > 255 || !curveKey || curveKey.length > 1024) return undefined;
  const payload = parseModelCatalogPayload(value.agentUserIds, value.models, {
    override: null,
    inherited: value.inherited,
  });
  if (!payload) return undefined;
  return {
    runtime: { id: JSON.stringify([userId, deviceId, curveKey]), userId, deviceId, curveKey },
    models: payload.models,
    agentUserIds: payload.agent_user_ids,
    ...(value.supportsRootModel === true && { supportsRootModel: true }),
    inherited: payload.selection.inherited,
  };
};

const decodeRoomCatalogs = (raw: string | null | undefined) => {
  const rooms = new Map<string, RoomCatalog[]>();
  if (!raw) return rooms;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return rooms;
  }
  if (!isRecord(stored) || stored.version !== STORAGE_VERSION || !isRecord(stored.rooms))
    return rooms;
  for (const [roomId, rawCatalogs] of Object.entries(stored.rooms).slice(-ROOM_CATALOG_LIMIT)) {
    if (!roomId.startsWith('!') || !Array.isArray(rawCatalogs)) continue;
    const catalogs = new Map<string, RoomCatalog>();
    for (const value of rawCatalogs.slice(0, 256) as unknown[]) {
      const catalog = parseRoomCatalog(value);
      if (catalog) catalogs.set(catalog.runtime.id, catalog);
    }
    if (catalogs.size) rooms.set(roomId, [...catalogs.values()]);
  }
  return rooms;
};

const encodeRoomCatalogs = (rooms: Map<string, RoomCatalog[]>): string | null => {
  const start = `{"version":${STORAGE_VERSION},"rooms":{`;
  const budget = STORAGE_CHAR_LIMIT - start.length - 2;
  const entries: string[] = [];
  let remaining = budget;
  for (const [roomId, catalogs] of [...rooms].reverse()) {
    const entry = `${JSON.stringify(roomId)}:${JSON.stringify(catalogs)}`;
    if (entry.length > budget) continue;
    if (entry.length > remaining) break;
    entries.push(entry);
    remaining -= entry.length + 1;
  }
  return entries.length ? `${start}${entries.reverse().join(',')}}}` : null;
};

/** Read once per lifetime. Tabs keep independent display seeds; the last writer wins. */
export const loadRoomCatalogs = (userId: string | null) => {
  const key = userId ? modelCatalogStorageKey(userId) : undefined;
  const storage = key ? getSafeLocalStorage() : undefined;
  const raw = key ? getStorageItemSafe(storage, key) : null;
  let saved = raw && raw.length > STORAGE_CHAR_LIMIT ? undefined : raw;
  const rooms = decodeRoomCatalogs(saved);
  return {
    rooms,
    save: () => {
      if (!storage || !key) return;
      const next = encodeRoomCatalogs(rooms);
      if (next === saved) return;
      if (next && setStorageItemSafe(storage, key, next)) saved = next;
      // A failed rewrite must not leave a possibly invalidated blob in place.
      else if (removeStorageItemSafe(storage, key)) saved = null;
    },
  };
};
