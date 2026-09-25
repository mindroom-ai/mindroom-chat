import React from 'react';
import { createRoot } from 'react-dom/client';
import { color, configClass, varsClass } from 'folds';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { darkTheme, lightTheme } from '../../src/colors.css';
import contract from '../../src/app/mindroom/documents/__fixtures__/microsoft365BackendContract.json';
import { DocumentCardView } from '../../src/app/mindroom/documents/MindroomDocumentCard';
import { DocumentEditReview } from '../../src/app/mindroom/documents/DocumentEditReview';
import { parseDocumentCard } from '../../src/app/mindroom/documents/documentProtocol';

const params = new URLSearchParams(window.location.search);
const dark = params.has('dark');
document.documentElement.className = `${configClass} ${varsClass} ${
  dark ? darkTheme : lightTheme
} ${dark ? 'dark-theme' : 'light-theme'}`;

const cards = contract.cases
  .filter(({ id }) => id.startsWith('thread/'))
  .map(({ id, event }) => ({
    id,
    card: parseDocumentCard((event.content as Record<string, unknown>)['io.mindroom.document']),
  }));
const redactedArguments = {
  ...contract.edit_arguments,
  edits: [
    ...contract.edit_arguments.edits,
    { range: 'Secrets!A1', before: [['***redacted***']], after: [['***redacted***']] },
  ],
};

function Fixture() {
  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 16,
        color: color.Surface.OnContainer,
        backgroundColor: color.Surface.Container,
      }}
    >
      {cards.map(({ id, card }) =>
        card ? (
          <div key={id} data-case={id}>
            <DocumentCardView card={card} />
          </div>
        ) : null
      )}
      <div data-case="review">
        <DocumentEditReview args={redactedArguments} />
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
