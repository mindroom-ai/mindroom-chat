import { createRoot } from 'react-dom/client';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n/i18n';
import { LightTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { ResizablePanel } from '../../src/app/ui/panels/ResizablePanel';
import { CustomEditor, useEditor } from '../../src/app/editor/Editor';

// A conversation of selectable messages (`.selectable`, as the timeline's) and the composer's text
// box, beside a side panel on the end side as a room shows a plugin panel: the panel closes when
// dragged narrow enough and stops at its widest. Query parameter: `width`, the panel's width before
// any drag (default its widest).
applyThemeToDom(LightTheme);
const width = Number(new URLSearchParams(window.location.search).get('width')) || 2000;

const paragraphs = Array.from(
  { length: 8 },
  (_, index) =>
    `Message ${index + 1}. The quick brown fox jumps over the lazy dog, and the lazy dog sleeps on.`
);

function Conversation() {
  const editor = useEditor();
  return (
    <main data-testid="conversation" style={{ flex: 1, minWidth: 0, padding: 16 }}>
      {paragraphs.map((text) => (
        <p key={text} className="selectable" style={{ margin: '0 0 12px' }}>
          {text}
        </p>
      ))}
      <CustomEditor editor={editor} editableName="RoomInput" placeholder="Send a message..." />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <div style={{ display: 'flex', height: '100vh' }}>
    <Conversation />
    <ResizablePanel
      side="end"
      storageKey="splitter-drag-fixture"
      defaultWidth={width}
      minContentWidth={360}
      maxPanelWidth={1200}
      resizeLabel="Resize Example panel"
      collapseLabel="Close Example panel"
      onCollapse={() => undefined}
      testId="example-panel"
    >
      <div style={{ padding: 16 }}>
        <p>Example panel. Pull request details would show here.</p>
      </div>
    </ResizablePanel>
  </div>
);
