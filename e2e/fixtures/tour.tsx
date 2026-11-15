import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import i18n from '../../src/app/i18n/i18n';
import { ScreenSizeProvider, useScreenSize } from '../../src/app/lib/hooks/useScreenSize';
import type { TourLevel } from '../../src/app/navigation/tourState';
import { LightTheme, THEMES } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { TourDialog } from '../../src/app/tour/TourDialog';

// The interface tour's dialog on a page of its own, so a spec can measure and picture every step
// without a homeserver. It records how the tour was closed in `body[data-tour-closed]`.
// Query parameters: `level` (quick or full; default full), `lang` (default en, which also sets
// the page's direction), `theme` (a theme name such as dark or green; default light) and `zoom`
// (the app's page zoom in percent, which scales the root font size; default 100).

const params = new URLSearchParams(window.location.search);
applyThemeToDom(THEMES.find((theme) => theme.id === `${params.get('theme')}-theme`) ?? LightTheme);

const zoom = Number(params.get('zoom'));
if (zoom > 0 && zoom !== 100) document.documentElement.style.fontSize = `${zoom}%`;

function Fixture() {
  const [level, setLevel] = useState<TourLevel>(params.get('level') === 'quick' ? 'quick' : 'full');
  const [open, setOpen] = useState(true);
  return (
    <ScreenSizeProvider value={useScreenSize()}>
      {open && (
        <TourDialog
          level={level}
          onLevelChange={setLevel}
          onClose={(how) => {
            document.body.dataset.tourClosed = how;
            setOpen(false);
          }}
        />
      )}
    </ScreenSizeProvider>
  );
}

void i18n.changeLanguage(params.get('lang') ?? 'en').then(async () => {
  document.documentElement.dir = i18n.dir();
  createRoot(document.getElementById('root')!).render(<Fixture />);
  await document.fonts.ready;
  document.body.dataset.fixtureReady = 'true';
});
