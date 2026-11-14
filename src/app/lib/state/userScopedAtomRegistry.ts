import { getSafeLocalStorage, removeStorageItemSafe } from '../safeLocalStorage';

export type UserScopedAtomRegistry<TAtom> = {
  getOrCreate: (userId: string) => TAtom;
  clear: (userId: string) => void;
};

type UserScopedAtomRegistryOptions<TAtom> = {
  create: (userId: string) => TAtom;
  getStorageKey: (userId: string) => string;
  cacheEmptyUserId?: boolean;
};

/**
 * Owns the repeated lifecycle shared by per-account UI atoms: stable atom
 * identity and account cleanup that forgets both memory and localStorage state.
 */
export const createUserScopedAtomRegistry = <TAtom>({
  create,
  getStorageKey,
  cacheEmptyUserId = true,
}: UserScopedAtomRegistryOptions<TAtom>): UserScopedAtomRegistry<TAtom> => {
  const atoms = new Map<string, TAtom>();

  const getOrCreate = (userId: string): TAtom => {
    if (!userId && !cacheEmptyUserId) return create(userId);

    const existing = atoms.get(userId);
    if (existing) return existing;

    const next = create(userId);
    atoms.set(userId, next);
    return next;
  };

  const clear = (userId: string): void => {
    const storageKey = getStorageKey(userId);
    removeStorageItemSafe(getSafeLocalStorage(), storageKey);
    atoms.delete(userId);
  };

  return { getOrCreate, clear };
};
