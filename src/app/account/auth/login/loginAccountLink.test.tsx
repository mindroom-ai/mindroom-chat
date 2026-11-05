import { create } from 'react-test-renderer';
import { createInstance } from 'i18next';
import { I18nextProvider, Trans } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { englishCatalog } from '../../../i18n/englishResources';

describe('the sign-in page link to registration', () => {
  it('asks "Don\'t have an account?" in English', async () => {
    const language = createInstance();
    await language.init({
      lng: 'en',
      resources: { en: { translation: englishCatalog } },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
    // Login.tsx renders this key.
    const renderer = create(
      <I18nextProvider i18n={language}>
        <Trans
          i18nKey="sharedUi.login.noAccountLink"
          components={{ authLink: <a href="/register">Register</a> }}
        />
      </I18nextProvider>
    );
    expect(renderer.toJSON()).toEqual([
      "Don't have an account? ",
      expect.objectContaining({ type: 'a', children: ['Register'] }),
    ]);
  });
});
