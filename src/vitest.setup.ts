import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { vi } from 'vitest';
import en from './app/locales/en.json';

// Component tests do not transform vanilla-extract files. Browser coverage
// exercises the real material recipe; unit tests only need its composed class.
vi.mock('./app/styles/Glass.css', () => ({
  glassShadow: '--glass-shadow',
  glassSurface: () => 'glass-surface',
}));

// Existing component tests replace Folds primitives with focused doubles.
// Keep those doubles in place without requiring every factory to implement
// the polymorphic helper used only by the visual wrapper.
vi.mock('./app/components/glass/GlassPrimitives', async () => {
  const folds = await import('folds');
  const wrappers: Record<string, unknown> = {};
  (['Menu', 'MenuItem', 'Modal', 'Dialog', 'Header'] as const).forEach((name) => {
    Object.defineProperty(wrappers, name, {
      enumerable: true,
      get: () => folds[name],
    });
  });
  return wrappers;
});

// Component tests use the real English catalog without browser detection or HTTP.
void i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  initImmediate: false,
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

class StorageMock implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const createStorageMock = (): Storage => new StorageMock();

if (typeof window !== 'undefined' && typeof window.localStorage?.clear !== 'function') {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: createStorageMock(),
  });
}
