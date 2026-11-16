import { createInstance, type ParseKeys } from 'i18next';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

// patches/i18next+23.12.2.patch: i18next 23.12 built a plural rule for every lookup with a count,
// which cost more than the rest of the translation; timeline rows look up several.
it('builds the plural rule of a language once', async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    resources: {
      en: { translation: { replies_one: '{{count}} reply', replies_other: '{{count}} replies' } },
    },
  });
  expect(i18n.t('replies' as ParseKeys, { count: 1 })).toBe('1 reply');

  const IntlPluralRules = Intl.PluralRules;
  const build = vi.spyOn(Intl, 'PluralRules').mockImplementation(function buildRule(...args) {
    return new IntlPluralRules(...args);
  });
  expect(i18n.t('replies' as ParseKeys, { count: 2 })).toBe('2 replies');
  expect(i18n.t('replies' as ParseKeys, { count: 1 })).toBe('1 reply');
  expect(i18n.t('replies' as ParseKeys, { count: 5, ordinal: false })).toBe('5 replies');
  expect(build).not.toHaveBeenCalled();
});
