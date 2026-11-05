import { useMemo } from 'react';
import { AccountDataEvent } from '../types/accountData';
import { useAccountData } from './useAccountData';

const EMPTY: string[] = [];

/** The user IDs in `m.ignored_user_list`, following changes. */
export const useIgnoredUsers = (): string[] => {
  const ignoredUserList = useAccountData(AccountDataEvent.IgnoredUserList);

  return useMemo(() => {
    const ignored: unknown = ignoredUserList?.getContent().ignored_users;
    if (!ignored || typeof ignored !== 'object' || Array.isArray(ignored)) return EMPTY;
    return Object.keys(ignored);
  }, [ignoredUserList]);
};
