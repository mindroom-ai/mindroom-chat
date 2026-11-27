import { atom, type WritableAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../../lib/state/atomWithLocalStorage';
import { createUserScopedAtomRegistry } from '../../lib/state/userScopedAtomRegistry';
import { homeExpandedDirectSectionsStorageKey } from '../../preferences/accountStorageKeys';
import { makeNavCategoryId } from './closedNavCategories';

/** Category IDs in the `'mindroom'` namespace so Home space-section selectors (`home|`) stay unaffected. */
export const HOME_DIRECT_CATEGORY_ID = makeNavCategoryId('mindroom', 'home-direct');
export const HOME_AGENTS_CATEGORY_ID = makeNavCategoryId('mindroom', 'home-agents');

const EXPANDED_SECTION_IDS: ReadonlySet<string> = new Set([
  HOME_DIRECT_CATEGORY_ID,
  HOME_AGENTS_CATEGORY_ID,
]);

const EMPTY_EXPANDED_SECTIONS: ReadonlySet<string> = new Set();

type ExpandedHomeDirectSectionsAtom = WritableAtom<ReadonlySet<string>, [string], void>;

const readExpandedSections = (key: string): ReadonlySet<string> => {
  const stored = getLocalStorageItem<unknown>(key, []);
  if (!Array.isArray(stored)) return EMPTY_EXPANDED_SECTIONS;
  const valid = stored.filter(
    (id): id is string => typeof id === 'string' && EXPANDED_SECTION_IDS.has(id)
  );
  return valid.length === 0 ? EMPTY_EXPANDED_SECTIONS : new Set(valid);
};

const writeExpandedSections = (key: string, expanded: ReadonlySet<string>): void => {
  const valid = Array.from(expanded).filter((id) => EXPANDED_SECTION_IDS.has(id));
  setLocalStorageItem(key, valid.length > 0 ? valid : undefined);
};

const createExpandedSectionsAtom = (userId: string): ExpandedHomeDirectSectionsAtom => {
  const valueAtom = userId
    ? atomWithLocalStorage<ReadonlySet<string>>(
        homeExpandedDirectSectionsStorageKey(userId),
        readExpandedSections,
        writeExpandedSections
      )
    : atom<ReadonlySet<string>>(EMPTY_EXPANDED_SECTIONS);

  return atom<ReadonlySet<string>, [string], void>(
    (get) => get(valueAtom),
    (get, set, categoryId) => {
      if (!EXPANDED_SECTION_IDS.has(categoryId)) return;
      const next = new Set(get(valueAtom));
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      set(valueAtom, next);
    }
  );
};

const registry = createUserScopedAtomRegistry<ExpandedHomeDirectSectionsAtom>({
  create: createExpandedSectionsAtom,
  getStorageKey: homeExpandedDirectSectionsStorageKey,
  cacheEmptyUserId: false,
});

/** Which compact Home sidebar sections are expanded via `Show all`, kept per account. */
export const getExpandedHomeDirectSectionsAtom = registry.getOrCreate;

/** Forgets the account's expanded Home sections, in memory and in local storage. */
export const clearExpandedHomeDirectSectionsStore = (userId: string): void =>
  registry.clear(userId);
