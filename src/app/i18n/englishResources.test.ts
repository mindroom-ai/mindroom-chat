import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { copyFiles } from '../../../vite.config';
import en from './locales/en.json';
import enAdditions from './locales/additions/en.json';
import { englishCatalog, mergeLocaleTrees } from './englishResources';

type LocaleTree = { [key: string]: string | LocaleTree };

const leaves = (tree: LocaleTree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([key, value]): Array<[string, string]> => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    return typeof value === 'string' ? [[path, value]] : leaves(value, path);
  });

describe('mergeLocaleTrees', () => {
  it('adds new leaves beside existing ones without changing either input', () => {
    const base = { a: { b: 'one' }, c: 'keep' };
    const overlay = { a: { d: 'two' }, e: { f: 'three' } };
    expect(mergeLocaleTrees(base, overlay)).toEqual({
      a: { b: 'one', d: 'two' },
      c: 'keep',
      e: { f: 'three' },
    });
    expect(base).toEqual({ a: { b: 'one' }, c: 'keep' });
    expect(overlay).toEqual({ a: { d: 'two' }, e: { f: 'three' } });
  });

  it('keeps the base text when both define a leaf', () => {
    expect(mergeLocaleTrees({ a: 'base' }, { a: 'overlay' })).toEqual({ a: 'base' });
  });
});

describe('English overlay (locales/additions/en.json)', () => {
  const base = new Map(leaves(en));
  const additions = leaves(enAdditions);

  it('adds only keys that en.json lacks', () => {
    expect(additions.length).toBeGreaterThan(0);
    additions.forEach(([path]) => expect(base.has(path), `${path} already in en.json`).toBe(false));
  });

  it('has no empty text', () => {
    additions.forEach(([path, value]) => expect(value.trim(), path).not.toBe(''));
  });

  it('merges into the English catalog', () => {
    expect(leaves(englishCatalog)).toHaveLength(base.size + additions.length);
    additions.forEach(([path, value]) => {
      expect(leaves(englishCatalog)).toContainEqual([path, value]);
    });
  });

  it('ships the language catalogs but not the overlay, which sits one level deeper', () => {
    expect(copyFiles.targets).toContainEqual({
      src: 'src/app/i18n/locales/*.json',
      dest: 'public/locales',
    });
  });

  it('is part of the configured app runtime', async () => {
    const { default: runtime } = await import('./i18n');
    if (!runtime.isInitialized) {
      await new Promise<void>((resolve) => {
        runtime.on('initialized', () => resolve());
      });
    }
    expect(runtime.t('sharedUi.passwordInput.hide')).toBe('Hide password');
    expect(runtime.t('settings.general.language.sectionTitle')).toBe('Language');
  });

  it('resolves in English and falls back to English in other languages', async () => {
    const instance = createInstance();
    await instance.init({
      lng: 'de',
      fallbackLng: 'en',
      resources: {
        en: { translation: englishCatalog },
        de: { translation: { settings: { general: { language: { appLanguage: 'Sprache' } } } } },
      },
    });
    expect(instance.t('sharedUi.passwordInput.show')).toBe('Show password');
    expect(instance.t('mindroomUi.notifications.invitation.body', { count: 1 })).toBe(
      'You have 1 new invitation request.'
    );
    expect(instance.t('mindroomUi.notifications.invitation.body', { count: 3 })).toBe(
      'You have 3 new invitation requests.'
    );
  });
});
