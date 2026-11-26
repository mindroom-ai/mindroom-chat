import { Capacitor, registerPlugin } from '@capacitor/core';
import FileSaver from 'file-saver';

type MindRoomFileSavePlugin = {
  beginSave(options: {
    fileName: string;
    pageId: string;
    mimeType?: string;
  }): Promise<{ id: string }>;
  appendSave(options: { id: string; data: string }): Promise<void>;
  presentSave(options: { id: string; mimeType?: string }): Promise<{ saved: boolean }>;
  openFile(options: { id: string; mimeType?: string }): Promise<{ opened: boolean }>;
  abortSave(options: { id: string }): Promise<void>;
};

const NATIVE_SAVE_CHUNK_SIZE = 256 * 1024;
const NATIVE_FILE_SAVE_PLATFORMS = new Set(['ios', 'android']);

let mindRoomFileSavePlugin: MindRoomFileSavePlugin | undefined;
let nativeSavePageId: string | undefined;

const getMindRoomFileSavePlugin = (): MindRoomFileSavePlugin => {
  if (!mindRoomFileSavePlugin) {
    mindRoomFileSavePlugin = registerPlugin<MindRoomFileSavePlugin>('MindRoomFileSave');
  }

  return mindRoomFileSavePlugin;
};

const getNativeSavePageId = (): string => {
  if (!nativeSavePageId) {
    const bytes = new Uint8Array(16);
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      bytes.forEach((_, index) => {
        bytes[index] = Math.floor(Math.random() * 256);
      });
    }
    nativeSavePageId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  return nativeSavePageId;
};

const isNativeFileSaveAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  NATIVE_FILE_SAVE_PLATFORMS.has(Capacitor.getPlatform()) &&
  Capacitor.isPluginAvailable('MindRoomFileSave');

/** Whether the native shell can hand off a staged file to an external viewer (Android). */
export const isNativeFileOpenAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'android' &&
  Capacitor.isPluginAvailable('MindRoomFileSave');

const resolveMimeType = (blob: Blob, explicitMimeType?: string): string | undefined => {
  const candidate = explicitMimeType?.trim() || blob.type?.trim();
  return candidate || undefined;
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read attachment'));
    reader.onload = () => {
      const dataUrl = reader.result;
      if (typeof dataUrl !== 'string') {
        reject(new Error('Failed to encode attachment'));
        return;
      }

      const separator = dataUrl.indexOf(',');
      if (separator === -1) {
        reject(new Error('Failed to encode attachment'));
        return;
      }

      resolve(dataUrl.slice(separator + 1));
    };
    reader.readAsDataURL(blob);
  });

const sourceToBlob = async (source: Blob | string): Promise<Blob> => {
  if (source instanceof Blob) return source;

  const response = await fetch(source);
  if (!response.ok) throw new Error(`Failed to read attachment (${response.status})`);
  return response.blob();
};

const runWithStagedNativeFile = async <T>(
  source: Blob | string,
  fileName: string,
  mimeType: string | undefined,
  finish: (
    plugin: MindRoomFileSavePlugin,
    id: string,
    resolvedMimeType: string | undefined
  ) => Promise<T>
): Promise<T> => {
  const blob = await sourceToBlob(source);
  const resolvedMimeType = resolveMimeType(blob, mimeType);
  const plugin = getMindRoomFileSavePlugin();
  let saveId: string | undefined;

  try {
    const session = await plugin.beginSave({
      fileName,
      pageId: getNativeSavePageId(),
      ...(resolvedMimeType ? { mimeType: resolvedMimeType } : {}),
    });
    saveId = session.id;

    for (let offset = 0; offset < blob.size; offset += NATIVE_SAVE_CHUNK_SIZE) {
      const chunk = blob.slice(offset, offset + NATIVE_SAVE_CHUNK_SIZE);
      const data = await blobToBase64(chunk);
      await plugin.appendSave({ id: saveId, data });
    }

    return await finish(plugin, saveId, resolvedMimeType);
  } catch (error) {
    if (saveId) {
      await plugin.abortSave({ id: saveId }).catch(() => undefined);
    }
    throw error;
  }
};

/**
 * Save a downloaded file using the platform's native destination picker on
 * iOS and Android. Other platforms retain FileSaver's existing browser behavior.
 */
export const saveFile = async (
  source: Blob | string,
  fileName: string,
  mimeType?: string
): Promise<boolean> => {
  if (!isNativeFileSaveAvailable()) {
    FileSaver.saveAs(source, fileName);
    return true;
  }

  return runWithStagedNativeFile(source, fileName, mimeType, async (plugin, id, resolvedMime) => {
    const result = await plugin.presentSave({
      id,
      ...(resolvedMime ? { mimeType: resolvedMime } : {}),
    });
    return result.saved;
  });
};

/**
 * Stage a file in the native Android cache and hand it to an external viewer
 * via `ACTION_VIEW`. Returns `false` when unavailable or when no viewer app is
 * installed.
 */
export const openNativeFile = async (
  source: Blob | string,
  fileName: string,
  mimeType?: string
): Promise<boolean> => {
  if (!isNativeFileOpenAvailable()) return false;

  return runWithStagedNativeFile(source, fileName, mimeType, async (plugin, id, resolvedMime) => {
    const result = await plugin.openFile({
      id,
      ...(resolvedMime ? { mimeType: resolvedMime } : {}),
    });
    return result.opened;
  });
};
