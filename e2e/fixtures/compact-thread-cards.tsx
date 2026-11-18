import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Icon, IconButton, Icons } from 'folds';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import i18n from '../../src/app/i18n/i18n';
import { LightTheme, THEMES } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { CompactThreadCard } from '../../src/app/threads/overview/CompactThreadCard';
import {
  CompactCardSwipe,
  useCompactCardSwipeList,
} from '../../src/app/threads/overview/CompactCardSwipe';
import { SwipeList } from '../../src/app/threads/overview/CompactCardSwipe.css';
import {
  formatCompactThreadMessageCount,
  getCompactThreadMessageCountLabel,
} from '../../src/app/threads/overview/compactThreadCardViewModel';
import * as css from '../../src/app/threads/overview/CompactRoomView.css';
import { CommandPaletteSearchField } from '../../src/app/command-palette/CommandPaletteSearchField';
import type { CompactThreadCardViewModel } from '../../src/app/event-store/threads/types';

// Screenshot fixture for the compact room view: a realistic agent room with
// unread, streaming, scheduled, tagged and resolved threads, rendered by the
// production card inside the same shell, swipe and action buttons as
// CompactRoomView. A swipe toggles a card's resolution; opening a card records
// its thread in `body[data-opened-thread]`.
// Query parameters: `lang` (default en), `theme` (a theme name such as dark or green; default
// light) and `crowded` (any value: busy placeholder cards instead, each with three
// writers, tags and a client plugin's pull request chips in its last row).

const params = new URLSearchParams(window.location.search);
applyThemeToDom(THEMES.find((theme) => theme.id === `${params.get('theme')}-theme`) ?? LightTheme);

const avatar = (background: string, label: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${background}"/><text x="16" y="21" font-size="15" text-anchor="middle" font-family="sans-serif" fill="white">${label}</text></svg>`
  )}`;

const mind = {
  userId: '@mindroom_mind:example.org',
  displayName: 'Mind',
  avatarUrl: avatar('#e07a5f', '🧠'),
};
const bas = { userId: '@bas:example.org', displayName: 'Bas', avatarUrl: avatar('#3d405b', 'B') };

const minutes = (count: number) => Date.now() - count * 60_000;
const days = (count: number) => Date.now() - count * 86_400_000 - 3_600_000;

type Sample = {
  title: string;
  tools?: number;
  preview: string;
  messageCount: number;
  lastActivityTs: number;
  participants?: (typeof mind)[];
  tags?: string[];
  isUnread?: boolean;
  isStreaming?: boolean;
  isResolved?: boolean;
  scheduled?: string;
  /** A client plugin's chips on the card (the pull request plugin's), and a count of the rest. */
  pullRequest?: { repo: string; number: number; more?: number };
};

const samples: Sample[] = [
  {
    title: '🎙️ Delegated Codex investigation of agent barge-in overtalk in MindRoom voice calls',
    tools: 11,
    preview: 'Report is committed. Reading it now and summarising the three root causes.',
    messageCount: 7,
    lastActivityTs: minutes(1),
    isStreaming: true,
    isUnread: true,
  },
  {
    title: '📝 Drafting a follow-up blog post on dependency thresholds and MindRoom evidence',
    tools: 4,
    preview: "Here's the full draft, rewritten around the threshold evidence you sent.",
    messageCount: 25,
    lastActivityTs: days(2),
    participants: [mind, bas],
    tags: ['blog', 'mindroom'],
    isUnread: true,
  },
  {
    title: '🔎 Config lookup for Vonk agent Matrix username',
    tools: 1,
    preview: "Sleutel's Matrix username is @mindroom_sleutel:mindroom.chat.",
    messageCount: 4,
    lastActivityTs: days(2),
    participants: [mind, bas],
  },
  {
    title: '🔍 Chase transaction review for fraud, duplicates, and unusual charges',
    tools: 2,
    preview: 'Sounds like a nightmare. The good news is that both charges are refundable.',
    messageCount: 5,
    lastActivityTs: days(3),
    participants: [mind, bas],
    scheduled: 'ma 09:00',
  },
  {
    title:
      'ISSUE-307: voice-call turn died with an Anthropic invalid_request_error about thinking blocks in the latest assistant message. Delegated to Codex gpt-6-astra for a fix',
    tools: 6,
    preview: 'The poke loop is waking on a todo that was already closed.',
    messageCount: 11,
    lastActivityTs: days(5),
    participants: [mind],
    tags: ['issue-307', 'mindroom'],
  },
  {
    title:
      '🔍 ISSUE-303 investigation of list_thread_tags vs client unresolved-thread count mismatch',
    tools: 3,
    preview: 'Both counts now agree after the cache fix.',
    messageCount: 9,
    lastActivityTs: days(5),
    participants: [mind, bas],
    isResolved: true,
  },
];

const router = {
  userId: '@mindroom_router:example.org',
  displayName: 'Router',
  avatarUrl: avatar('#81b29a', 'R'),
};
const crowd = [mind, router, bas];

const crowdedSamples: Sample[] = [
  {
    title: '🧪 Example thread with a long enough title',
    tools: 4,
    preview: 'Placeholder preview text for the first sample card.',
    messageCount: 43,
    lastActivityTs: minutes(11),
    participants: crowd,
    tags: ['alpha', 'beta', 'gamma'],
    pullRequest: { repo: 'example-repo', number: 101, more: 7 },
  },
  {
    title: '🧪 Example thread that is streaming',
    tools: 8,
    preview: 'A',
    messageCount: 66,
    lastActivityTs: minutes(0),
    participants: crowd,
    tags: ['delta', 'epsilon'],
    isStreaming: true,
    pullRequest: { repo: 'example', number: 2002, more: 1 },
  },
  {
    title: '🧪 Example thread whose title wraps onto a second line on a phone',
    tools: 5,
    preview: 'Placeholder preview text that is long enough to end in an ellipsis.',
    messageCount: 50,
    lastActivityTs: minutes(27),
    participants: crowd,
    tags: ['zeta', 'eta'],
    pullRequest: { repo: 'example-other', number: 303, more: 10 },
  },
  {
    title: '🧪 Example unread thread with several numbers #1, #2, #3, #4',
    tools: 9,
    preview: 'Placeholder preview text for an unread sample card.',
    messageCount: 52,
    lastActivityTs: minutes(1),
    participants: crowd,
    tags: ['theta', 'iota', 'kappa'],
    isUnread: true,
    pullRequest: { repo: 'example-repo', number: 404, more: 3 },
  },
  {
    title: 'Short',
    tools: 6,
    preview: 'Placeholder preview text for a card with a long repository name.',
    messageCount: 124,
    lastActivityTs: minutes(4),
    participants: crowd,
    pullRequest: { repo: 'example-very-long-repository-name', number: 5, more: 13 },
  },
];

// The pull request plugin's chips, drawn as its styles.css draws them: a row that keeps its size
// (`flex: none`), so on a phone the card's last row can run out of room.
const chipStyle = {
  boxSizing: 'border-box',
  display: 'inline-flex',
  flex: 'none',
  alignItems: 'center',
  padding: '0.1rem 0.4rem',
  border: '1px solid currentColor',
  borderRadius: 9999,
  fontSize: '0.75rem',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
} as const;

function PullRequestChips({ repo, number, more }: { repo: string; number: number; more?: number }) {
  return (
    <span
      data-fixture-plugin-chips=""
      style={{ display: 'inline-flex', flex: 'none', alignItems: 'center', gap: 4 }}
    >
      <span style={chipStyle}>
        <span style={{ overflow: 'hidden', maxInlineSize: '12ch', textOverflow: 'ellipsis' }}>
          {repo}
        </span>
        &nbsp;#{number}
      </span>
      {more ? <span style={chipStyle}>+{more}</span> : null}
    </span>
  );
}

const chipsOf = ({ pullRequest }: Sample) => pullRequest && <PullRequestChips {...pullRequest} />;

const toViewModel = (sample: Sample, index: number): CompactThreadCardViewModel => {
  const toolBadge = sample.tools
    ? `🔧 ${i18n.t('sharedUi.threadPreviews.tools', { count: sample.tools })} · `
    : '';
  return {
    id: { roomId: '!personal:example.org', threadRootId: `$thread-${index}` },
    titleText: sample.title,
    displayTitleText: sample.title,
    previewText: `Mind: ${toolBadge}${sample.preview}`,
    messageCount: sample.messageCount,
    messageCountLabel: getCompactThreadMessageCountLabel(
      sample.messageCount,
      i18n.t,
      i18n.language
    ),
    messageCountText: formatCompactThreadMessageCount(sample.messageCount, i18n.language),
    attentionState: sample.isResolved
      ? 'resolved'
      : sample.isStreaming
      ? 'streaming'
      : 'needs-attention',
    attentionStatusText: '',
    participants: sample.participants ?? [mind],
    tags: sample.tags ?? [],
    isResolved: sample.isResolved === true,
    resolvedByDisplayName: sample.isResolved ? 'Bas' : undefined,
    isUnread: sample.isUnread === true,
    isStreaming: sample.isStreaming === true,
    scheduledDisplayText: sample.scheduled,
    scheduledTaskLabel: sample.scheduled ? `Next task ${sample.scheduled}` : undefined,
    lastActivityTs: sample.lastActivityTs,
    lastActivityTitle: new Date(sample.lastActivityTs).toLocaleString(i18n.language),
  };
};

const openThread = (threadRootId: string) => {
  document.body.dataset.openedThread = threadRootId;
};

function Fixture() {
  const [items, setItems] = useState(params.has('crowded') ? crowdedSamples : samples);
  const listRef = useRef<HTMLDivElement>(null);
  useCompactCardSwipeList(listRef);
  const setResolved = (index: number, isResolved: boolean) =>
    setItems((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, isResolved } : item))
    );

  return (
    <Box className={css.View} data-compact-room-view="true" style={{ flex: 'none' }}>
      {/* The phone's top bar shows this field over the room. */}
      {params.has('crowded') && <CommandPaletteSearchField />}
      <Box ref={listRef} className={SwipeList} direction="Column" gap="100" shrink="No">
        {items.map(toViewModel).map((viewModel, index) => (
          <div key={viewModel.id.threadRootId} className={css.CardShell}>
            <CompactCardSwipe
              enabled
              resolved={viewModel.isResolved}
              label={i18n.t(viewModel.isResolved ? 'threadActions.reopen' : 'thread.resolve')}
              onSwipe={(wasResolved) => setResolved(index, !wasResolved)}
            >
              <CompactThreadCard
                viewModel={viewModel}
                onClick={openThread}
                badges={chipsOf(items[index]!)}
              />
              <div className={css.CardAction}>
                <IconButton
                  className={css.CardQuickAction}
                  size="300"
                  variant="Secondary"
                  fill="None"
                  radii="300"
                  aria-label="Resolve"
                >
                  <Icon size="100" src={Icons.Check} />
                </IconButton>
                <IconButton
                  className={css.CardQuickAction}
                  size="300"
                  variant="Secondary"
                  fill="None"
                  radii="300"
                  aria-label="Pin"
                >
                  <Icon size="100" src={Icons.Pin} />
                </IconButton>
                <IconButton
                  className={css.CardMenuButton}
                  size="300"
                  variant="Secondary"
                  fill="None"
                  radii="300"
                  aria-label="More options"
                >
                  <Icon size="100" src={Icons.HorizontalDots} />
                </IconButton>
              </div>
            </CompactCardSwipe>
          </div>
        ))}
      </Box>
    </Box>
  );
}

void i18n.changeLanguage(params.get('lang') ?? 'en').then(async () => {
  createRoot(document.getElementById('root')!).render(<Fixture />);
  await document.fonts.ready;
  document.body.dataset.fixtureReady = 'true';
});
