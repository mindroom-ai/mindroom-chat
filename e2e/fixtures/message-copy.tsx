import React from 'react';
import { createRoot } from 'react-dom/client';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { Box, color, configClass, varsClass } from 'folds';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { darkTheme, lightTheme } from '../../src/colors.css';
import { Menu } from '../../src/app/components/glass/GlassPrimitives';
import { MessageCopyTextItem } from '../../src/app/mindroom/messages/MessageCopyActions';

const params = new URLSearchParams(window.location.search);
const dark = params.has('dark');
document.documentElement.className = `${configClass} ${varsClass} ${dark ? darkTheme : lightTheme}`;

const content = params.has('plain')
  ? { msgtype: 'm.text', body: 'Plain reply with $x^2$.' }
  : {
      msgtype: 'm.text',
      body: 'Let me check.\n\n🔧 `search_web` [1]\n\nIt is sunny, $T = 21^\\circ C$.',
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_completed',
            tool_name: 'search_web',
            args_preview: 'query=weather Amsterdam',
            result_preview: 'Sunny, 21°C',
          },
        ],
      },
    };

const room = { getTimelineForEvent: () => null } as unknown as Room;
const mEvent = {
  getId: () => '$copy-fixture',
  getContent: () => content,
} as unknown as MatrixEvent;

createRoot(document.getElementById('root')!).render(
  <main
    style={{
      padding: 24,
      color: color.Surface.OnContainer,
      background: color.Surface.Container,
      minHeight: '100vh',
    }}
  >
    <Menu style={{ width: 220 }}>
      <Box direction="Column" gap="100" style={{ padding: 4 }}>
        <MessageCopyTextItem room={room} mEvent={mEvent} onClose={() => undefined} />
      </Box>
    </Menu>
  </main>
);
