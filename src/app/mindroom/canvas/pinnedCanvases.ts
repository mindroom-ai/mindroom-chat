import type { MatrixClient } from 'matrix-js-sdk';
import { isRecord } from '../../utils/isRecord';

/** Account data, so pins follow the user to every device. */
export const PINNED_CANVASES_TYPE = 'io.mindroom.pinned_canvases';

export type PinnedCanvas = { roomId: string; canvasId: string };

/** Pins hold IDs only: account data is not encrypted, and a canvas's title is. */
export const readPinnedCanvases = (content: unknown): PinnedCanvas[] => {
  const canvases = isRecord(content) && Array.isArray(content.canvases) ? content.canvases : [];
  const seen = new Set<string>();
  return canvases.flatMap((pin) => {
    if (
      !isRecord(pin) ||
      typeof pin.room_id !== 'string' ||
      !pin.room_id.startsWith('!') ||
      typeof pin.event_id !== 'string' ||
      !pin.event_id.startsWith('$') ||
      seen.has(pin.event_id)
    ) {
      return [];
    }
    seen.add(pin.event_id);
    return [{ roomId: pin.room_id, canvasId: pin.event_id }];
  });
};

export const writePinnedCanvases = async (
  mx: MatrixClient,
  pins: PinnedCanvas[]
): Promise<void> => {
  await mx.setAccountData(
    PINNED_CANVASES_TYPE as never,
    { canvases: pins.map((pin) => ({ room_id: pin.roomId, event_id: pin.canvasId })) } as never
  );
};
