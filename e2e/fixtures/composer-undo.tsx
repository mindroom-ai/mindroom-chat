import { createRoot } from 'react-dom/client';
import { configClass, varsClass } from 'folds';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import { lightTheme } from '../../src/colors.css';
import { CustomEditor, useEditor } from '../../src/app/components/editor';

// The composer's text box alone, with the editor the room composer uses, for history checks.
document.documentElement.className = `${configClass} ${varsClass} ${lightTheme}`;

function ComposerUndo() {
  const editor = useEditor();
  return (
    <main style={{ maxWidth: 600, margin: '40px auto' }}>
      <CustomEditor editor={editor} editableName="RoomInput" placeholder="Send a message..." />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ComposerUndo />);
