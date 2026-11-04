import { createRoot } from 'react-dom/client';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { DarkTheme, LightTheme } from '../../src/app/hooks/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { ClientConfigProvider, type ClientConfig } from '../../src/app/hooks/useClientConfig';
import { MindroomThinkingPlaceholder } from '../../src/app/mindroom/messages/MindroomThinkingPlaceholder';
import { MINDROOM_THINKING_PLACEHOLDER_BODY } from '../../src/app/mindroom/messages/thinkingPlaceholder';

// Query flags: `dark` theme, `rtl` direction, `label=<text>` replaces the default "Thinking…",
// and `elapsed=<ms>` starts the counter that many milliseconds ago.
const query = new URLSearchParams(window.location.search);
applyThemeToDom(query.has('dark') ? DarkTheme : LightTheme);
if (query.has('rtl')) document.documentElement.dir = 'rtl';

const label = query.get('label') ?? MINDROOM_THINKING_PLACEHOLDER_BODY;
const elapsed = query.get('elapsed');
const startedAt = elapsed === null ? undefined : Date.now() - Number(elapsed);
const config: ClientConfig = { mindroom: { thinkingPlaceholderMessages: [label] } };

// A reply in the timeline (16 px text) and the same reply in a compact card preview (14 px).
const contexts = [
  { name: 'Timeline reply', fontSize: 16 },
  { name: 'Card preview', fontSize: 14 },
];

createRoot(document.getElementById('root')!).render(
  <ClientConfigProvider value={config}>
    <main style={{ display: 'grid', gap: 16, padding: 16, minWidth: 0 }}>
      {contexts.map(({ name, fontSize }) => (
        <section key={name} aria-label={name} style={{ fontSize, lineHeight: 1.5, minWidth: 0 }}>
          <MindroomThinkingPlaceholder startedAt={startedAt} />
        </section>
      ))}
    </main>
  </ClientConfigProvider>
);
