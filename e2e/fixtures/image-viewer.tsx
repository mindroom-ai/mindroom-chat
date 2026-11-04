import { createRoot } from 'react-dom/client';
import { Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { LightTheme } from '../../src/app/hooks/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { Modal } from '../../src/app/components/glass/GlassPrimitives';
import { ImageViewer } from '../../src/app/components/image-viewer';

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

// The viewer in the dialog an opened image message shows it in.
createRoot(document.getElementById('root')!).render(
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
);
