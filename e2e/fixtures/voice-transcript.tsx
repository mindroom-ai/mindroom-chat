import { createRoot } from 'react-dom/client';
import { createClient, MsgType } from 'matrix-js-sdk';
import { Provider } from 'jotai';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n/i18n';
import { DarkTheme, LightTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/matrix/hooks/useMatrixClient';
import { SpecVersionsProvider } from '../../src/app/matrix/hooks/useSpecVersions';
import { MAudio } from '../../src/app/messages/content/MsgTypeRenderers';
import {
  VoiceTranscript,
  VoiceTranscriptPending,
} from '../../src/app/messages/content/VoiceTranscript';
import {
  MATRIX_AUDIO_DETAILS_PROPERTY_NAME,
  MATRIX_VOICE_MESSAGE_PROPERTY_NAME,
} from '../../src/app/matrix/types/common';

// Settled and pending voice messages, with placeholder data only.
const dark = new URLSearchParams(window.location.search).get('theme') === 'dark';
applyThemeToDom(dark ? DarkTheme : LightTheme);
document.body.style.cssText = `margin:24px; background:${dark ? '#1a1a1a' : '#fff'};`;

const voice = {
  msgtype: MsgType.Audio,
  body: 'voice.ogg',
  url: 'mxc://fixture/audio',
  info: { mimetype: 'audio/wav', duration: 9000, size: 192044 },
  [MATRIX_VOICE_MESSAGE_PROPERTY_NAME]: {},
  [MATRIX_AUDIO_DETAILS_PROPERTY_NAME]: {
    duration: 9000,
    waveform: [80, 240, 600, 320, 880, 1024, 450, 200, 740, 550, 170, 80],
  },
};
const echo = { msgtype: MsgType.Text, 'com.mindroom.visible_router_voice_echo': true };
const cases = [
  {
    name: 'Transcribed voice message',
    transcript: (
      <VoiceTranscript
        content={{ ...echo, body: '🎤 Remind me to water the ferns on Thursday.' }}
        senderName="Helper"
      />
    ),
  },
  { name: 'Voice message being transcribed', transcript: <VoiceTranscriptPending /> },
  {
    name: 'Historical router transcript',
    transcript: (
      <VoiceTranscript
        content={{ ...echo, body: '🎤 Add oat milk to the list.' }}
        senderName="Router"
      />
    ),
  },
];

createRoot(document.getElementById('root')!).render(
  <Provider>
    <MatrixClientProvider
      value={createClient({ baseUrl: window.location.origin, userId: '@fixture:localhost' })}
    >
      <SpecVersionsProvider value={{ versions: ['v1.10'] }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 560 }}>
          {cases.map(({ name, transcript }) => (
            <section key={name} aria-label={name}>
              <MAudio content={voice} renderAsFile={() => <div>Unsupported audio</div>} />
              {transcript}
            </section>
          ))}
        </div>
      </SpecVersionsProvider>
    </MatrixClientProvider>
  </Provider>
);
