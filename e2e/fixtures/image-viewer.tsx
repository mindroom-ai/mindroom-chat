import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n/i18n';
import { LightTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { Modal } from '../../src/app/ui/glass/GlassPrimitives';
import { ImageViewer } from '../../src/app/messages/viewers/ImageViewer';
import { ImageOverlay } from '../../src/app/messages/content/ImageOverlay';
import { ScreenSize, ScreenSizeProvider } from '../../src/app/lib/hooks/useScreenSize';

applyThemeToDom(LightTheme);

// A 4:3 picture drawn inline, so the viewer needs no homeserver.
const picture = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">',
  '<rect width="800" height="600" fill="#2f6fd6"/>',
  '<circle cx="400" cy="300" r="180" fill="#ffd166"/>',
  '<rect x="80" y="420" width="640" height="100" rx="24" fill="#06d6a0"/>',
  '</svg>',
].join('');
const src = `data:image/svg+xml,${encodeURIComponent(picture)}`;

// With `?phone`, the viewer as a phone opens it, the second of three pictures; `#viewer-state`
// tells whether it is open and which picture it shows.
function PhoneViewer() {
  const [open, setOpen] = useState(true);
  const [index, setIndex] = useState(1);
  return (
    <ScreenSizeProvider value={ScreenSize.Mobile}>
      <p id="viewer-state">{`${open ? 'open' : 'closed'} ${index}`}</p>
      <ImageOverlay
        src={open ? src : undefined}
        alt="Test image"
        requestClose={() => setOpen(false)}
        position={{ index, count: 3 }}
        onStep={(delta) => setIndex((shown) => Math.min(2, Math.max(0, shown + delta)))}
      />
    </ScreenSizeProvider>
  );
}

// The viewer in the dialog an opened image message shows it in.
createRoot(document.getElementById('root')!).render(
  new URLSearchParams(window.location.search).has('phone') ? (
    <PhoneViewer />
  ) : (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <Modal
          size="500"
          style={{ width: '90vw', height: '90vh', maxWidth: 'none', maxHeight: 'none' }}
        >
          <ImageViewer src={src} alt="Test image" requestClose={() => undefined} />
        </Modal>
      </OverlayCenter>
    </Overlay>
  )
);
