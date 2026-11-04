import { createRoot } from 'react-dom/client';
import { Box } from 'folds';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { LightTheme } from '../../src/app/hooks/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { Menu } from '../../src/app/components/glass/GlassPrimitives';
import { MessageCopyTextItem } from '../../src/app/mindroom/messages/MindroomMessage';
import { MessageMenuGroup } from '../../src/app/features/room/message/styles.css';

applyThemeToDom(LightTheme);

// An agent reply as MindRoom sends it: a tool marker in the text and the structured trace
// beside it. `?plain` drops both, as in a reply that called no tools.
const plain = new URLSearchParams(window.location.search).has('plain');
const answer = 'It is sunny, $T = 21^\\circ C$.';
const answerHtml = `<p>It is sunny, <span data-mx-maths="T = 21^\\circ C"><code>T = 21^\\circ C</code></span>.</p>`;
const content: Record<string, unknown> = plain
  ? {
      msgtype: 'm.text',
      body: `Let me check.\n\n${answer}`,
      format: 'org.matrix.custom.html',
      formatted_body: `<p>Let me check.</p>\n${answerHtml}\n`,
    }
  : {
      msgtype: 'm.text',
      body: `Let me check.\n\n🔧 \`search_web\` [1]\n\n${answer}`,
      format: 'org.matrix.custom.html',
      formatted_body: `<p>Let me check.</p>\n<p>🔧 <code>search_web</code> [1]</p>\n${answerHtml}\n`,
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

// The message menu's copy entry, at the width the menu has in the timeline.
createRoot(document.getElementById('root')!).render(
  <div style={{ padding: 16 }}>
    <Menu style={{ width: 'min(100%, 16rem)' }}>
      <Box direction="Column" gap="100" className={MessageMenuGroup}>
        <MessageCopyTextItem content={content} />
      </Box>
    </Menu>
  </div>
);
