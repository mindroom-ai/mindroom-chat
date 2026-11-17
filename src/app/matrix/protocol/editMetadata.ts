import { isMessageMetadataKey } from './metadata';

// Says that this event's own file holds the message, so it is never inherited from another edit.
const LONG_TEXT_KEY = 'io.mindroom.long_text';

/**
 * Client-only, never sent: when the edit that carries a borrowed stream status was sent. Written
 * beside the status it goes with (`getEditedEvent`), so it is never inherited on its own.
 */
export const STREAM_STATUS_TS_KEY = 'io.mindroom.stream_status_ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const copyResolvedEditMetadata = (
  resolvedContent: Record<string, unknown>,
  sources: ReadonlyArray<Record<string, unknown> | undefined>
): void => {
  sources.forEach((source) => {
    if (!source) return;

    const newContent = isRecord(source['m.new_content']) ? source['m.new_content'] : undefined;
    [newContent, source].forEach((metadataSource) => {
      if (!metadataSource) return;

      Object.entries(metadataSource).forEach(([key, value]) => {
        if (resolvedContent[key] !== undefined) return;
        if (!isMessageMetadataKey(key) || key === LONG_TEXT_KEY || key === STREAM_STATUS_TS_KEY) {
          return;
        }
        resolvedContent[key] = value;
      });
    });
  });
};
