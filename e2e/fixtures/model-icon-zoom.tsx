import { createRoot } from 'react-dom/client';
import { createClient, MemoryStore } from 'matrix-js-sdk';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import { LightTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/matrix/hooks/useMatrixClient';
import { IconButton } from '../../src/app/ui/glass/GlassPrimitives';
import { glassExpanded } from '../../src/app/ui/styles/Glass.css';
import { EffortGlyph } from '../../src/app/models/EffortGlyph';
import { ModelIcon } from '../../src/app/models/ModelIcon';
import * as css from '../../src/app/models/ModelPicker.css';

// The composer's model button as ModelPicker draws it: a custom icon from Matrix media (the spec
// answers its request) and a provider mark, each with effort bars.
applyThemeToDom(LightTheme);

const client = createClient({
  baseUrl: window.location.origin,
  userId: '@fixture:localhost',
  store: new MemoryStore(),
});

const models = [
  { name: 'Custom icon', provider: 'openai', id: 'example-model', iconUrl: 'mxc://localhost/icon' },
  { name: 'Provider mark', provider: 'anthropic', id: 'claude-example' },
];

createRoot(document.getElementById('root')!).render(
  <MatrixClientProvider value={client}>
    <main style={{ display: 'flex', gap: '1rem', padding: '1rem' }}>
      {models.map(({ name, provider, id, iconUrl }) => (
        <IconButton
          key={name}
          type="button"
          variant="SurfaceVariant"
          radii="300"
          size="300"
          className={`${css.Trigger} ${glassExpanded}`}
          aria-label={name}
          data-effort
        >
          <ModelIcon provider={provider} id={id} iconUrl={iconUrl} size={20} />
          <EffortGlyph count={3} filled={2} />
        </IconButton>
      ))}
    </main>
  </MatrixClientProvider>
);
