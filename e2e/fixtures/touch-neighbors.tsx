import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, configClass, varsClass } from 'folds';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n/i18n';
import { darkTheme, lightTheme } from '../../src/app/theme/colors.css';
import { ApprovalDurations } from '../../src/app/approvals/ApprovalSection';
import { ThreadActivity } from '../../src/app/ui/ThreadActivity';
import { SenderLine } from '../../src/app/messages/styles.css';

document.documentElement.className = `${configClass} ${varsClass} ${
  new URLSearchParams(location.search).has('dark') ? darkTheme : lightTheme
}`;

function Neighbors() {
  const [picked, setPicked] = useState(0);
  return (
    <main style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <section>
        <Box className={SenderLine}>
          <button type="button">River Writer</button>
        </Box>
        <ThreadActivity icon={null} title="Review details">
          Route checked.
        </ThreadActivity>
        <a href="#route">Route notes</a>
      </section>
      {[0, 1].map((row) => (
        <ApprovalDurations
          key={row}
          durations={[300, 600, 1800]}
          accessibleLabel={(seconds) => `Allow for ${seconds / 60} minutes`}
          onPick={setPicked}
        />
      ))}
      <a href="#schedule">Schedule notes</a>
      <output aria-label="Picked duration">{picked}</output>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Neighbors />);
