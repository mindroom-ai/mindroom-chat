import { createRoot } from 'react-dom/client';
import { useTranslation } from 'react-i18next';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import i18n, { registerNamespace } from '../../src/app/i18n/i18n';
import { LightTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { LanguageRegion } from '../../src/app/settings/pages/LanguageRegion';

// The Language & region settings page beside a line from a namespace registered next to the app's
// catalog, as a plugin registers `plugin.<id>`: its English ships here, and every other language's
// comes from /plugin-locales/<code>.json, which the spec serves.

const NAMESPACE = 'plugin.demo';

applyThemeToDom(LightTheme);

void registerNamespace(NAMESPACE, { greeting: 'Hello from the plugin' }, async (language) => {
  const response = await fetch(`/plugin-locales/${language}.json`);
  return response.ok ? ((await response.json()) as { greeting: string }) : undefined;
});

// The spec reads which catalogs have arrived.
Object.assign(window, { fixtureI18n: i18n });

function PluginGreeting() {
  // The app's typed keys cover its own catalog only; checking a key against all of them is too
  // deep a type for the compiler, so this namespace's `t` takes any key (as a plugin's does).
  const t = useTranslation(NAMESPACE as never).t as unknown as (key: string) => string;
  return <p data-testid="plugin-greeting">{t('greeting')}</p>;
}

createRoot(document.getElementById('root')!).render(
  <>
    <PluginGreeting />
    <LanguageRegion requestClose={() => undefined} />
  </>
);
