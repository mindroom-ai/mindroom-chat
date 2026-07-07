export const APPSTORE_FIXTURE_ROOM_ALIAS = '#mindroom-app-store-personal-showcase:matrix.localhost';
export const APPSTORE_FIXTURE_ROOM_NAME = 'Personal';
export const APPSTORE_FIXTURE_ROOM_TOPIC =
  'Personal agent workspace for chat-native AI assistants, watchers, tools, and persistent memory.';
export const APPSTORE_FIXTURE_PRIMARY_DISPLAY_NAME = 'Bas Nijholt';
export const APPSTORE_FIXTURE_PRIMARY_AVATAR_URL =
  'https://media.githubusercontent.com/media/basnijholt/nijho.lt/refs/heads/main/content/authors/admin/avatar.jpg';

export const APPSTORE_FIXTURE_AGENT_PASSWORD = 'Pwappstoreagent123!';

const TOOL_MARKER_PATTERN = /^\s*🔧\s+`([^`]+)`\s+\[(\d+)\](?:\s+(⏳))?\s*$/u;

const escapeHtml = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderInlineMarkdown = (value) => {
  const parts = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  let match = pattern.exec(value);

  while (match !== null) {
    if (match.index > cursor) {
      parts.push(escapeHtml(value.slice(cursor, match.index)));
    }

    const token = match[0];
    if (token.startsWith('`')) {
      parts.push(`<code>${escapeHtml(token.slice(1, -1))}</code>`);
    } else {
      parts.push(`<strong>${escapeHtml(token.slice(2, -2))}</strong>`);
    }
    cursor = match.index + token.length;
    match = pattern.exec(value);
  }

  if (cursor < value.length) {
    parts.push(escapeHtml(value.slice(cursor)));
  }

  return parts.join('');
};

export const bodyToFormattedHtml = (body) => {
  const htmlParts = [];
  let paragraphLines = [];
  let bulletItems = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    htmlParts.push(`<p>${paragraphLines.map(renderInlineMarkdown).join('<br/>')}</p>`);
    paragraphLines = [];
  };

  const flushBulletList = () => {
    if (bulletItems.length === 0) return;
    htmlParts.push(
      `<ul>${bulletItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`
    );
    bulletItems = [];
  };

  body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((line) => {
      const toolMarker = TOOL_MARKER_PATTERN.exec(line);
      if (toolMarker) {
        flushParagraph();
        flushBulletList();
        htmlParts.push(
          `<p>🔧 <code>${escapeHtml(toolMarker[1])}</code> [${toolMarker[2]}]${
            toolMarker[3] ? ' ⏳' : ''
          }</p>`
        );
        return;
      }

      if (line.trim() === '') {
        flushParagraph();
        flushBulletList();
        return;
      }

      const heading = /^(#{1,6})\s+(.+)$/.exec(line);
      if (heading) {
        flushParagraph();
        flushBulletList();
        const level = Math.min(heading[1].length, 6);
        htmlParts.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        return;
      }

      const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
      if (bullet) {
        flushParagraph();
        bulletItems.push(bullet[1]);
        return;
      }

      flushBulletList();
      paragraphLines.push(line);
    });

  flushParagraph();
  flushBulletList();
  return htmlParts.join('');
};

export const textMessage = (body, extraContent = {}) => ({
  msgtype: 'm.text',
  body,
  format: 'org.matrix.custom.html',
  formatted_body: bodyToFormattedHtml(body),
  ...extraContent,
});

export const noticeMessage = (body, extraContent = {}) => ({
  msgtype: 'm.notice',
  body,
  format: 'org.matrix.custom.html',
  formatted_body: bodyToFormattedHtml(body),
  ...extraContent,
});

const buildAiRunMetadata = ({ runId, toolCount = 0, outputTokens = 0 }) => ({
  'io.mindroom.ai_run': {
    version: 1,
    status: 'completed',
    run_id: runId,
    model: {
      provider: 'mindroom',
      id: 'fake-release-agent',
      config: 'app-store-screenshot-fixture',
    },
    usage: {
      input_tokens: 1280,
      output_tokens: outputTokens,
      total_tokens: 1280 + outputTokens,
      time_to_first_token: 1,
    },
    tools: {
      count: toolCount,
    },
  },
  'io.mindroom.stream_status': 'completed',
});

const buildToolTraceMetadata = (events) => ({
  'io.mindroom.tool_trace': {
    version: 2,
    events,
  },
});

export const getAppStoreFixtureAgentDefinitions = () => [
  {
    key: 'mind',
    username: 'mindroom_mind',
    password: APPSTORE_FIXTURE_AGENT_PASSWORD,
    displayName: 'Mind',
    avatarAssetPath: 'public/res/branding/mindroom-logo-square.png',
  },
  {
    key: 'router',
    username: 'mindroom_router',
    password: APPSTORE_FIXTURE_AGENT_PASSWORD,
    displayName: 'RouterAgent',
    avatarAssetPath: 'public/res/branding/mindroom-favicon.png',
  },
];

const summaryContent = ({ emoji, summary, messageCount }) => {
  const contextualSummary = `${emoji} ${summary}`;

  return noticeMessage(contextualSummary, {
    'io.mindroom.thread_summary': {
      version: 1,
      generated_at: '2026-07-04T17:15:00.000Z',
      message_count: messageCount,
      summary: contextualSummary,
    },
  });
};

const scheduledAtDaysFromNow = (days, hourUtc, minuteUtc) => {
  const scheduled = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  scheduled.setUTCHours(hourUtc, minuteUtc, 0, 0);
  return scheduled.toISOString();
};

export const buildAppStoreFixtureThreads = ({ primaryUserId, agentUserIds }) => [
  {
    id: 'personal-workspace',
    root: {
      sender: 'primary',
      body: 'What should I pay attention to today?',
      content: textMessage('What should I pay attention to today?'),
    },
    replies: [
      {
        sender: 'router',
        content: textMessage(
          [
            'I grouped the active personal-agent work into watchers, decisions, and follow-ups.',
            '',
            '## Current focus for Bas',
            '- **Campground monitor:** healthy, scheduled, and quiet until an opening appears.',
            '- **Car search:** two promising leads are waiting for comparison.',
            '- **MindRoom overview:** Mind answered the public product explanation prompt.',
            '- **Home reminders:** batched for the evening check-in.',
          ].join('\n'),
          buildAiRunMetadata({
            runId: 'fixture-router-personal-standup',
            outputTokens: 214,
          })
        ),
      },
    ],
    summary: {
      sender: 'mind',
      content: summaryContent({
        emoji: '🧭',
        summary:
          'Today: campground watcher is healthy, car search has new leads, and Mind explained the personal-agent workflow.',
        messageCount: 34,
      }),
    },
    tags: ['daily', 'personal'],
    scheduledAt: scheduledAtDaysFromNow(7, 18, 0),
  },
  {
    id: 'mindroom-explained',
    root: {
      sender: 'primary',
      body: 'Mind, explain what MindRoom is and what you can do as a personal agent.',
      content: textMessage(
        'Mind, explain what MindRoom is and what you can do as a personal agent.'
      ),
    },
    replies: [
      {
        sender: 'mind',
        content: textMessage(
          [
            'MindRoom is a personal AI agent platform that lives in chat.',
            '',
            '## What I can do',
            '',
            'You can talk to specialized agents in Matrix rooms, threads, DMs, or bridged apps. Agents can answer questions, use tools, remember useful context, coordinate with each other, handle files and attachments, search the web, run code, schedule follow-ups, and help manage ongoing projects.',
            '',
            'It is built for practical everyday assistance: less "chatbot in a box," more capable digital teammate you can reach from the conversations you already use.',
            '',
            '## Everyday examples',
            '- Watch for **campground cancellations** and send a clean status update.',
            '- Compare **car listings**, summarize trade-offs, and prepare negotiation notes.',
            '- Keep long-running personal projects organized in Matrix threads.',
            '- Remember preferences that should carry across future conversations.',
            '- Use tools when needed, then show the work in the same thread.',
          ].join('\n'),
          buildAiRunMetadata({
            runId: 'fixture-mindroom-explainer',
            outputTokens: 356,
          })
        ),
      },
      {
        sender: 'primary',
        content: textMessage('Good. This is the clearer personal-agent story for the screenshots.'),
      },
    ],
    summary: {
      sender: 'mind',
      content: summaryContent({
        emoji: '💬',
        summary:
          'MindRoom overview: chat-native personal agents, tools, memory, and scheduled follow-ups.',
        messageCount: 27,
      }),
    },
    tags: ['product'],
  },
  {
    id: 'campground-monitor',
    root: {
      sender: 'primary',
      body: 'Keep watching for a weekend campground cancellation and let me know if a good site opens.',
      content: textMessage(
        'Keep watching for a weekend campground cancellation and let me know if a good site opens.'
      ),
    },
    replies: [
      {
        sender: 'mind',
        content: textMessage(
          [
            'Daily watcher status:',
            '',
            '🔧 `check campground availability` [1]',
            '🔧 `update watchlist state` [2]',
            '🔧 `schedule next scan` [3]',
            '',
            '## Result',
            '- **No matching weekend openings yet.**',
            '- The monitor is healthy and checked all saved criteria.',
            '- Next scan is scheduled for `30 minutes` from now.',
            '',
            '## Next update',
            'I will keep this thread updated only when there is a meaningful change, so the room stays quiet until action is useful.',
          ].join('\n'),
          {
            ...buildAiRunMetadata({
              runId: 'fixture-campground-monitor',
              toolCount: 3,
              outputTokens: 244,
            }),
            ...buildToolTraceMetadata([
              {
                type: 'tool_call_completed',
                tool_name: 'check campground availability',
                args_preview: 'date_range=next-weekend filters=lakefront,walkable',
                result_preview: 'No matching cancellations found.',
              },
              {
                type: 'tool_call_completed',
                tool_name: 'update watchlist state',
                args_preview: 'watcher=campground-weekend-v1',
                result_preview: 'Saved latest healthy check timestamp.',
              },
              {
                type: 'tool_call_completed',
                tool_name: 'schedule next scan',
                args_preview: 'interval=30m quiet_until=availability-change',
                result_preview: 'Next watcher run scheduled.',
              },
            ]),
          }
        ),
      },
    ],
    summary: {
      sender: 'mind',
      content: summaryContent({
        emoji: '🏕️',
        summary:
          'Campground monitor: daily watcher healthy, no matching openings yet, next scan scheduled.',
        messageCount: 103,
      }),
    },
    tags: ['watcher', 'camping'],
    scheduledAt: scheduledAtDaysFromNow(7, 16, 30),
  },
  {
    id: 'car-search',
    root: {
      sender: 'primary',
      body: 'Help me compare the latest car options and prep negotiation notes.',
      content: textMessage('Help me compare the latest car options and prep negotiation notes.'),
    },
    replies: [
      {
        sender: 'router',
        content: textMessage(
          'Routing this to Mind because it needs remembered preferences, research, and a practical shortlist.',
          buildAiRunMetadata({
            runId: 'fixture-router-car-search',
            outputTokens: 78,
          })
        ),
      },
      {
        sender: 'mind',
        content: textMessage(
          [
            'I updated the shortlist with two promising options and one backup.',
            '',
            '- **Option A:** better value if the service history checks out.',
            '- **Option B:** cleaner photos, weaker price signal.',
            '- **Prep:** three negotiation points and a pre-purchase inspection checklist.',
          ].join('\n'),
          buildAiRunMetadata({
            runId: 'fixture-mind-car-shortlist',
            outputTokens: 184,
          })
        ),
      },
    ],
    summary: {
      sender: 'mind',
      content: summaryContent({
        emoji: '🚗',
        summary:
          'Car search: shortlist updated with two promising options and one negotiation checklist.',
        messageCount: 68,
      }),
    },
    tags: ['research', 'car'],
  },
  {
    id: 'home-reminders',
    root: {
      sender: 'primary',
      body: 'Batch the household reminders for tonight.',
      content: textMessage('Batch the household reminders for tonight.'),
    },
    replies: [
      {
        sender: 'mind',
        content: textMessage(
          [
            "Tonight's batch is ready:",
            '',
            '- **Package:** confirm the pickup window.',
            '- **Calendar:** add the maintenance note.',
            '- **Morning summary:** keep low-priority errands out.',
          ].join('\n'),
          buildAiRunMetadata({
            runId: 'fixture-mind-home-reminders',
            outputTokens: 128,
          })
        ),
      },
    ],
    summary: {
      sender: 'mind',
      content: summaryContent({
        emoji: '🏠',
        summary: 'Home reminders: package pickup and maintenance note are queued for tonight.',
        messageCount: 9,
      }),
    },
    tags: ['home'],
  },
];

export const buildScheduledTaskContent = (threadRootId, executeAt) => ({
  status: 'pending',
  thread_id: threadRootId,
  new_thread: false,
  execute_at: executeAt,
});

export const buildCanonicalThreadTagStateKey = (threadRootId, tagName) =>
  JSON.stringify([threadRootId, tagName]);

export const buildThreadTagContent = (userId, setAt = '2026-07-04T17:20:00.000Z') => ({
  set_by: userId,
  set_at: setAt,
});
