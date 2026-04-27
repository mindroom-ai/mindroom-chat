import { isMindroomMessageMetadataKey } from './metadata';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export const copyMindroomResolvedEditMetadata = (
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
        if (!isMindroomMessageMetadataKey(key)) return;
        resolvedContent[key] = value;
      });
    });
  });
};
