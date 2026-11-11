import { createRoot } from 'react-dom/client';
import { usePluginTranslation } from '@mindroom/client-sdk/core';
import { bootFixturePage } from '@mindroom/client-sdk/fixtures';
import { useThemeKind } from '@mindroom/client-sdk/ui';

// Served at /e2e-plugins/sample-plugin/e2e/fixtures/page.html (scripts/e2e-plugin-pages.mjs), with React
// from this repository's packages, set up as the app sets itself up, in the dark theme.
const ID = 'e2e-sample';
const plugin = { translations: { en: { rendered: "Rendered by the sample plugin's page" } } };

function Page() {
  const t = usePluginTranslation(ID);
  return <p>{`${t('rendered')}, ${useThemeKind()}`}</p>;
}

await bootFixturePage({ id: ID, plugin, appearance: 'dark' });
const root = document.getElementById('root');
if (root) createRoot(root).render(<Page />);
