import { isMindroomMessageMetadataKey } from './metadata';

export const copyMindroomResolvedEditMetadata = (
  resolvedContent: Record<string, unknown>,
  sources: ReadonlyArray<Record<string, unknown> | undefined>
): void => {
  sources.forEach((source) => {
    if (!source) return;

    Object.entries(source).forEach(([key, value]) => {
      if (resolvedContent[key] !== undefined) return;
      if (!isMindroomMessageMetadataKey(key)) return;
      resolvedContent[key] = value;
    });
  });
};
