import dayjs from 'dayjs';
import { afterEach, describe, expect, it } from 'vitest';
import { syncDayjsLocale } from './appLocale';

describe('syncDayjsLocale', () => {
  afterEach(() => {
    dayjs.locale('en');
  });

  it('keeps dayjs on the same supported base language as i18next', () => {
    expect(syncDayjsLocale('de-AT')).toBe('de');
    expect(dayjs.locale()).toBe('de');

    expect(syncDayjsLocale('nl-BE')).toBe('nl');
    expect(dayjs.locale()).toBe('nl');
  });

  it('falls back unsupported locales to English', () => {
    expect(syncDayjsLocale('fr')).toBe('en');
    expect(dayjs.locale()).toBe('en');
  });
});
