import {
  Fragment,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useInRouterContext } from 'react-router-dom';
import type { MatrixClient } from 'matrix-js-sdk';
import { isTag, isText, type ChildNode } from 'domhandler';
import { domToReact, type DOMNode, type HTMLReactParserOptions } from 'html-react-parser';
import Linkify from 'linkify-react';
import type { Opts as LinkifyOpts } from 'linkifyjs';
import { Icon, Icons, Text } from 'folds';
import { IconBolt } from '@tabler/icons-react';
import { copyToClipboard } from '../lib/dom';
import { ownDirectionBlock, revealDirectionControls } from '../ui/directional';
import { useHour24Clock } from '../preferences/useHour24Clock';
import { useSettingValue } from '../preferences/useSettingValue';
import { settingsAtom } from '../preferences/settings';
import { useOptionalMatrixClient } from '../matrix/hooks/useMatrixClient';
import { testMatrixTo } from '../matrix/matrix-to';
import type { TriggerWakeInfo } from '../matrix/protocol/triggerWake';
import { CheckedMessageLink } from '../rich-text/CheckedMessageLink';
import { CheckIcon, CopyIcon } from '../rich-text/code/CodeBlockIcons';
import { stripBidiControls } from '../rich-text/linkDestination';
import { parseInlineMDWithRules } from '../rich-text/markdown/inline/parser';
import {
  BoldRule,
  EscapeRule,
  ItalicRule1,
  ItalicRule2,
  LinkRule,
  StrikeRule,
} from '../rich-text/markdown/inline/rules';
import { parseHtml } from '../rich-text/parseHtml';
import { sanitizeCustomHtml, sanitizeText } from '../rich-text/sanitize';
import {
  LINKIFY_OPTS,
  factoryRenderLinkifyWithMention,
  makeMentionCustomProps,
  renderMatrixMention,
} from './html/react-custom-html-parser';
import { openRoomTriggersDialog, roomTriggersQueryKey } from '../navigation/roomTriggersDialog';
import { useMentionClickHandler } from './useMentionClickHandler';
import { Time } from './Time';
import * as css from './TriggerWakeMarker.css';

const KEY = 'mindroomUi.messages.triggerWakeMarker';
const COPIED_FEEDBACK_MS = 2000;

const PROMPT_INLINE_RULES = [BoldRule, ItalicRule1, ItalicRule2, StrikeRule, LinkRule, EscapeRule];

const LINK_TAGS: ReadonlySet<string> = new Set(['a']);
const NO_LINKIFY_TAGS: ReadonlySet<string> = new Set(['a', 'code']);

const hasAncestor = (node: ChildNode, tags: ReadonlySet<string>): boolean => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isTag(parent) && tags.has(parent.name)) return true;
  }
  return false;
};

type PromptMentionContext = {
  client: MatrixClient;
  roomId?: string;
  handleMentionClick?: MouseEventHandler<HTMLElement>;
};

const textContent = (nodes: ChildNode[]): string =>
  nodes
    .map((node) => {
      if (isText(node)) return node.data;
      if (isTag(node)) return textContent(node.children);
      return '';
    })
    .join('');

const createPromptHtmlOptions = (mention?: PromptMentionContext): HTMLReactParserOptions => {
  const linkifyOpts: LinkifyOpts = {
    ...LINKIFY_OPTS,
    render: factoryRenderLinkifyWithMention((href) =>
      mention
        ? renderMatrixMention(
            mention.client,
            mention.roomId,
            href,
            makeMentionCustomProps(mention.handleMentionClick)
          )
        : undefined
    ),
  };

  const options: HTMLReactParserOptions = {
    replace: (node) => {
      if (isText(node)) {
        if (hasAncestor(node, NO_LINKIFY_TAGS)) {
          return (
            <>
              {hasAncestor(node, LINK_TAGS)
                ? stripBidiControls(node.data)
                : revealDirectionControls(node.data)}
            </>
          );
        }
        return <Linkify options={linkifyOpts}>{revealDirectionControls(node.data)}</Linkify>;
      }
      if (!isTag(node)) return undefined;
      const children = domToReact(node.children as DOMNode[], options);
      switch (node.name) {
        case 'a': {
          const { href } = node.attribs;
          if (!href) return <>{children}</>;
          if (mention && testMatrixTo(href)) {
            const ownText = stripBidiControls(textContent(node.children)).trim() !== href;
            const rendered = renderMatrixMention(
              mention.client,
              mention.roomId,
              href,
              makeMentionCustomProps(mention.handleMentionClick),
              ownText ? children : undefined,
              ownText
            );
            if (rendered) return rendered;
          }
          return (
            <CheckedMessageLink
              href={href}
              rel={node.attribs.rel || 'noreferrer noopener'}
              target={node.attribs.target || '_blank'}
            >
              {children}
            </CheckedMessageLink>
          );
        }
        case 'strong':
          return <strong>{children}</strong>;
        case 'i':
        case 'em':
          return <i>{children}</i>;
        case 's':
        case 'del':
          return <s>{children}</s>;
        case 'code':
          return <code className={css.InlineCode}>{children}</code>;
        default:
          return <>{children}</>;
      }
    },
  };
  return options;
};

const renderPromptContent = (text: string, mention?: PromptMentionContext): ReactNode => {
  try {
    const html = sanitizeCustomHtml(
      parseInlineMDWithRules(sanitizeText(text), PROMPT_INLINE_RULES)
    );
    return parseHtml(html, createPromptHtmlOptions(mention));
  } catch {
    return revealDirectionControls(text);
  }
};

function TriggerWakePromptBody({
  text,
  mention,
}: {
  text: string;
  mention?: PromptMentionContext;
}) {
  const content = useMemo(() => renderPromptContent(text, mention), [text, mention]);
  return (
    <Text as="p" size="T200" className={css.Prompt} {...ownDirectionBlock}>
      {content}
    </Text>
  );
}

function ConnectedTriggerWakePrompt({
  text,
  client,
  roomId,
}: {
  text: string;
  client: MatrixClient;
  roomId?: string;
}) {
  const handleMentionClick = useMentionClickHandler(roomId ?? '');
  const mention = useMemo<PromptMentionContext>(
    () => ({ client, roomId, handleMentionClick }),
    [client, roomId, handleMentionClick]
  );
  return <TriggerWakePromptBody text={text} mention={mention} />;
}

type TriggerWakeMarkerProps = {
  wake: TriggerWakeInfo;
  ts?: number;
  roomId?: string;
};

const summaryParts = (wake: TriggerWakeInfo): string[] =>
  [wake.kind ?? wake.sourceType, wake.triggerId]
    .filter((part, index, list): part is string => !!part && list.indexOf(part) === index)
    .map(revealDirectionControls);

const describeSource = (wake: TriggerWakeInfo): string | undefined => {
  if (wake.sourceType && wake.kind && wake.sourceType !== wake.kind) {
    return `${wake.sourceType} / ${wake.kind}`;
  }
  return wake.sourceType ?? wake.kind;
};

/**
 * Quiet 1-line marker for a MindRoom reactive or direct external trigger wake event.
 * Expands in place to show trigger metadata, prompt text, and optional JSON event payload.
 */
export function TriggerWakeMarker({ wake, ts, roomId }: TriggerWakeMarkerProps) {
  const { t } = useTranslation();
  const [hour24Clock] = useHour24Clock();
  const dateFormatString = useSettingValue(settingsAtom, 'dateFormatString');
  const client = useOptionalMatrixClient();
  const inRouter = useInRouterContext();
  const store = useStore();
  const queryClient = useContext(QueryClientContext);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const panelId = useId();

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const summary = summaryParts(wake);
  const source = describeSource(wake);
  const metaItems: ReactNode[] = [];
  if (wake.triggerId) {
    const id = revealDirectionControls(wake.triggerId);
    const label = t(`${KEY}.triggerLabel`, { id });
    metaItems.push(
      roomId ? (
        <button
          key="trigger"
          type="button"
          data-trigger-wake-link={wake.triggerId}
          aria-haspopup="dialog"
          aria-label={t(`${KEY}.openTriggerLabel`, { id })}
          onClick={(event) => {
            void queryClient?.invalidateQueries({ queryKey: roomTriggersQueryKey(roomId) });
            openRoomTriggersDialog(store, roomId, {
              triggerId: wake.triggerId!,
              opener: event.currentTarget,
            });
          }}
        >
          {label}
        </button>
      ) : (
        label
      )
    );
  }
  if (source) {
    metaItems.push(t(`${KEY}.sourceLabel`, { source: revealDirectionControls(source) }));
  }
  if (wake.triage) {
    metaItems.push(t(`${KEY}.triageLabel`, { reason: revealDirectionControls(wake.triage) }));
  }
  if (ts !== undefined && Number.isFinite(ts)) {
    metaItems.push(
      <Time key="time" ts={ts} hour24Clock={hour24Clock} dateFormatString={dateFormatString} />
    );
  }
  const promptText = wake.prompt || (metaItems.length === 0 && !wake.eventJson ? wake.rawBody : '');
  const copyLabel = copied
    ? t('messageCodeBlock.copied')
    : t('mindroomUi.messages.messageCopyActions.copyText');

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    const done = await copyToClipboard(wake.rawBody, event.currentTarget);
    setCopied(done);
    clearTimeout(copiedTimer.current);
    if (done) copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };

  return (
    <div className={css.Marker} data-trigger-wake={wake.sourceKind}>
      <button
        type="button"
        className={css.Trigger}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => setExpanded((value) => !value)}
      >
        <IconBolt size={14} aria-hidden />
        <Text as="span" size="T200" className={css.Title}>
          {t(wake.sourceKind === 'reactive' ? `${KEY}.triggered` : `${KEY}.webhook`)}
        </Text>
        {summary.length > 0 && (
          <Text as="span" size="T200" className={css.Summary}>
            {summary.map((part, index) => (
              <Fragment key={`${index}:${part}`}>
                {index > 0 ? ' · ' : null}
                <bdi>{part}</bdi>
              </Fragment>
            ))}
          </Text>
        )}
        <Icon size="50" src={expanded ? Icons.ChevronTop : Icons.ChevronBottom} aria-hidden />
      </button>
      {expanded && (
        <div id={panelId} className={css.Panel} data-trigger-wake-details="true">
          <div className={css.PanelHeader}>
            {metaItems.length > 0 && (
              <Text as="span" size="T200" priority="400" className={css.Meta}>
                {metaItems.map((item, index) => (
                  <Fragment key={index}>
                    {index > 0 ? ' · ' : null}
                    {item}
                  </Fragment>
                ))}
              </Text>
            )}
            <button
              type="button"
              className={css.CopyButton}
              aria-label={copyLabel}
              title={copyLabel}
              onClick={(event) => void handleCopy(event)}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
          {promptText &&
            (client && inRouter ? (
              <ConnectedTriggerWakePrompt text={promptText} client={client} roomId={roomId} />
            ) : (
              <TriggerWakePromptBody text={promptText} />
            ))}
          {wake.eventJson && (
            <pre
              className={css.Payload}
              dir="ltr"
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
              tabIndex={0}
              role="region"
              aria-label={t(`${KEY}.payloadLabel`)}
            >
              {revealDirectionControls(wake.eventJson)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
