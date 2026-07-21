import { createHash } from 'node:crypto';

export type ContentFingerprint = { length: number; sha256: string };

export const fingerprintText = (value: string): ContentFingerprint => ({
  length: Array.from(value).length,
  sha256: createHash('sha256').update(value).digest('hex'),
});

export const fingerprintsMatch = (
  actual: ContentFingerprint,
  expected: ContentFingerprint
): boolean => actual.length === expected.length && actual.sha256 === expected.sha256;

export const orderedSignalIdsMatch = (expected: string[], actual: string[]): boolean =>
  expected.length === actual.length &&
  expected.every((eventId, index) => actual[index] === eventId);
