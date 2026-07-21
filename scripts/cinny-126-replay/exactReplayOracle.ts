import { createHash } from 'node:crypto';

export type ContentFingerprint = { length: number; sha256: string };

export const EXACT_REPLAY_FINGERPRINTS = {
  compactCard: {
    length: 130,
    sha256: 'd26be706ac88a80c3fca6d6d1ec077d6895385620a3e4140690acfd38eef6c10',
  },
  effectiveBody: {
    length: 1466,
    sha256: 'cb33887e78c29746e7f067b4b5f42c5e1bfe4729f79316365dc50a49668f764c',
  },
  globalThreads: {
    length: 1409,
    sha256: 'ba43826cf0de033e3cd28ad68a4d8f41910ddcc49fba9cc4f215577674ca7a96',
  },
  overviewTags: {
    length: 48,
    sha256: 'a2d9249053753ef70a4d7b00d40e348ec4abddc64fa1e860104826ec671239b9',
  },
  presentation: {
    length: 1409,
    sha256: 'ba43826cf0de033e3cd28ad68a4d8f41910ddcc49fba9cc4f215577674ca7a96',
  },
} as const satisfies Record<string, ContentFingerprint>;

export const fingerprintText = (value: string): ContentFingerprint => ({
  length: Array.from(value).length,
  sha256: createHash('sha256').update(value).digest('hex'),
});

export const fingerprintsMatch = (
  actual: ContentFingerprint,
  expected: ContentFingerprint
): boolean => actual.length === expected.length && actual.sha256 === expected.sha256;
