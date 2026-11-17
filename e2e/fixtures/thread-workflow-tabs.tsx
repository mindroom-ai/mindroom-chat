import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import i18n from '../../src/app/i18n/i18n';
import { LightTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { RoomThreadOverview } from '../../src/app/threads/overview/RoomThreadOverview';
import type { ThreadWorkflowTab } from '../../src/app/event-store/threads/threadWorkflow';

applyThemeToDom(LightTheme);
const noop = () => {};

// Production toolbar with deliberately large buckets, without creating hundreds of Matrix events.
function Fixture() {
  const [tab, setTab] = useState<ThreadWorkflowTab>('needsYou');
  return (
    <RoomThreadOverview
      hasMindroomAgents
      threadCount={999}
      totalThreadCount={3996}
      bucketCounts={{ needsYou: 999, working: 999, later: 999, done: 999, all: 3996 }}
      state={{
        tab,
        resolved: 'any',
        snoozed: 'any',
        streaming: 'any',
        scheduled: 'any',
        unread: 'any',
        idle: 'any',
        sortBy: 'natural',
        sortDirection: 'desc',
        tags: new Map(),
        freeText: '',
        unsupportedQuery: '',
        statusMode: 'and',
      }}
      availableTags={['review']}
      onSelectTab={setTab}
      onSortDirectionChange={noop}
      onToggleThreadSortFreeze={noop}
      onReset={noop}
      onClearTags={noop}
      onRemoveTag={noop}
      onAddTag={noop}
      onSearchQueryChange={noop}
    />
  );
}

void i18n.changeLanguage(new URLSearchParams(location.search).get('lang') ?? 'en').then(() => {
  createRoot(document.getElementById('root')!).render(<Fixture />);
});
