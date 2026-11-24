import { createInstance, type ParseKeys } from 'i18next';
import { expect, it } from 'vitest';

// Fixed upstream in i18next 26.5 (previously backported by patches/i18next+23.12.2.patch).
it('inserts an escaped value that contains its own placeholder once', async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: { joined: '<b>{{userName}}</b> joined the room' } } },
  });

  // Escaping lengthens "&" (i18next 27 leaves "/" unescaped); when escaping added more characters
  // than the text after the inner placeholder, older i18next resumed inside the inserted value and
  // expanded it up to 1000 times.
  expect(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
    i18n.t('joined' as ParseKeys, {
      userName: 'Maya&&&&/$&{{userName}}',
      interpolation: { escapeValue: true },
    })
  ).toBe('<b>Maya&amp;&amp;&amp;&amp;/$&amp;{{userName}}</b> joined the room');
});
