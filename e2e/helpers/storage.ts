import { Page } from '@playwright/test';

type SessionLike = {
  sessionId: string;
  deviceId?: string;
};

export const readIndexedDbNames = async (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const databases = await indexedDB.databases();
    return databases
      .map((database) => database.name)
      .filter((name): name is string => typeof name === 'string')
      .sort();
  });

export const getExpectedSessionDbNames = (session: SessionLike): string[] => {
  const names = [
    `matrix-js-sdk:web-sync-store::${session.sessionId}`,
  ];

  if (session.deviceId) {
    const rustPrefix = `matrix-js-sdk::${session.sessionId}::${encodeURIComponent(
      session.deviceId
    )}`;
    names.push(`${rustPrefix}::matrix-sdk-crypto`);
  }

  return names;
};
