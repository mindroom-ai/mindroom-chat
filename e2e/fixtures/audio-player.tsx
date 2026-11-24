import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, MsgType } from 'matrix-js-sdk';
import { Provider } from 'jotai';
import 'folds/dist/style.css';
import '@fontsource-variable/inter';
import '../../src/index.css';
import '../../src/app/i18n/i18n';
import { DarkTheme, LightTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/matrix/hooks/useMatrixClient';
import { SpecVersionsProvider } from '../../src/app/matrix/hooks/useSpecVersions';
import { MAudio } from '../../src/app/messages/content/MsgTypeRenderers';
import {
  MATRIX_AUDIO_DETAILS_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
} from '../../src/app/matrix/types/common';

const params = new URLSearchParams(window.location.search);
const dark = params.get('theme') === 'dark';
const virtualized = params.get('virtualized') === '1';
applyThemeToDom(dark ? DarkTheme : LightTheme);
document.body.style.cssText = `margin:24px; background:${dark ? '#1a1a1a' : '#fff'};`;

const audioContent = {
  msgtype: MsgType.Audio,
  body: 'Interview with the design team.wav',
  url: 'mxc://fixture/audio',
  info: { mimetype: 'audio/wav', duration: 12000, size: 192044 },
};

const voiceContent = {
  ...audioContent,
  body: 'voice.wav',
  url: 'mxc://fixture/voice',
  [MATRIX_VOICE_MESSAGE_PROPERTY_NAME]: {},
  [MATRIX_AUDIO_DETAILS_PROPERTY_NAME]: {
    duration: 12000,
    waveform: [80, 240, 600, 320, 880, 1024, 450, 200, 740, 550, 170, 80],
  },
};

function AudioPlayerFixture() {
  const [showVoice, setShowVoice] = useState(true);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 24 }}>
      <section aria-label="Audio attachment" style={{ display: 'inline-flex', maxWidth: '100%' }}>
        <MAudio content={audioContent} renderAsFile={() => <div>Unsupported audio</div>} />
      </section>
      {showVoice ? (
        <section aria-label="Voice message" style={{ display: 'inline-flex', maxWidth: '100%' }}>
          <MAudio content={voiceContent} renderAsFile={() => <div>Unsupported audio</div>} />
        </section>
      ) : null}
      {virtualized ? (
        <button type="button" onClick={() => setShowVoice((shown) => !shown)}>
          {showVoice ? 'Unmount voice message' : 'Mount voice message'}
        </button>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <Provider>
    <MatrixClientProvider
      value={createClient({ baseUrl: window.location.origin, userId: '@fixture:localhost' })}
    >
      <SpecVersionsProvider value={{ versions: ['v1.10'] }}>
        <AudioPlayerFixture />
      </SpecVersionsProvider>
    </MatrixClientProvider>
  </Provider>
);
