// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { Trans } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// Replaces the removed ESCAPED_TRANS lint rule: fails if a future react-i18next release stops
// escaping interpolated <Trans> values under the app's escapeValue: false + numberFormatter setup.
describe('Trans escaping with the app i18n runtime', () => {
  let runtime: typeof import('./i18n').default;

  beforeAll(async () => {
    runtime = (await import('./i18n')).default;
  });

  afterEach(cleanup);

  it('renders markup-like values as literal text with no extra elements or attributes', () => {
    expect(runtime.options.interpolation?.escapeValue).toBe(false);
    expect(runtime.options.interpolation?.alwaysFormat).toBe(true);
    expect(runtime.t('sharedUi.threadPreviews.tools', { count: 1234 })).toBe('1,234 tools');

    const payloads = ['<img src=x onerror=alert(1)>', '<0>x</0>', '</b><b title="pwn">'];
    for (const payload of payloads) {
      const { container, unmount } = render(
        <Trans
          i18n={runtime}
          i18nKey="sharedUi.invites.from"
          values={{ sender: payload }}
          components={{ b: <b /> }}
        />
      );
      const elements = Array.from(container.querySelectorAll('*'));
      expect(elements.map((el) => el.tagName)).toEqual(['B']);
      expect(Array.from(elements[0]!.attributes)).toEqual([]);
      expect(elements[0]!.textContent).toBe(payload);
      expect(container.textContent).toBe(`From: ${payload}`);
      unmount();
    }
  });
});
