import { createRoot } from 'react-dom/client';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n/i18n';
import { LightTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { PageScroll } from '../../src/app/ui/page/PageScroll';

// A page of selectable cards in a PageScroll, as a space's lobby lists its rooms, taller than the
// window, so its inset scrollbar has a track to drag; below it, an editable draft, as a room's
// composer sits under its timeline.
applyThemeToDom(LightTheme);

const cards = Array.from(
  { length: 40 },
  (_, index) =>
    `Example room ${index + 1}. The quick brown fox jumps over the lazy dog, and the dog sleeps on.`
);

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
    <PageScroll scrollbarLabel="Scroll example page" data-testid="example-page">
      <div style={{ padding: 16 }}>
        {cards.map((text) => (
          <p key={text} className="selectable" style={{ margin: '0 0 24px' }}>
            {text}
          </p>
        ))}
      </div>
    </PageScroll>
    <div
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Example draft"
      style={{ flexShrink: 0, padding: 16, borderTop: '1px solid' }}
    >
      Draft message placeholder
    </div>
  </div>
);
