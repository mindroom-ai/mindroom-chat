import { useMemo } from 'react';
import { AccountDataEvent } from '../types/accountData';
import { useAccountData } from './useAccountData';

const EMPTY: string[] = [];

/** The users the account has direct rooms with, from `m.direct`. */
export const useDirectUsers = (): string[] => {
  const mDirect = useAccountData(AccountDataEvent.Direct);

  return useMemo(() => {
    const content: unknown = mDirect?.getContent();
    if (!content || typeof content !== 'object' || Array.isArray(content)) return EMPTY;
    return Object.entries(content as Record<string, unknown>)
      .filter(([, roomIds]) => Array.isArray(roomIds) && roomIds.length > 0)
      .map(([userId]) => userId);
  }, [mDirect]);
};
