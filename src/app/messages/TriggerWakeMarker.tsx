import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { isTag, isText, type ChildNode } from 'domhandler';
import parse, {
  attributesToProps,
  domToReact,
  type HTMLReactParserOptions,
} from 'html-react-parser';
import Linkify from 'linkify-react';
import type { IntermediateRepresentation, Opts as LinkifyOpts } from 'linkifyjs';
import { Icon, Icons, Text } from 'folds';
import { IconBolt } from '@tabler/icons-react';
import { copyToClipboard } from '../lib/dom';
import { ownDirectionBlock, revealDirectionControls } from '../ui/directional';
import { useHour24Clock } from '../preferences/useHour24Clock';
import { useSettingValue } from '../preferences/useSettingValue';
import { settingsAtom } from '../preferences/settings';
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
import { sanitizeCustomHtml, sanitizeText } from '../rich-text/sanitize';
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

const renderPromptLinkify = ({ attributes, content }: IntermediateRepresentation) => (
  <CheckedMessageLink {...attributesToProps(attributes)}>
    {stripBidiControls(content)}
  </CheckedMessageLink>
);

const PROMPT_LINKIFY_OPTS: LinkifyOpts = {
  rel: 'noreferrer noopener',
  target: '_blank',
  defaultProtocol: 'https',
  validate: {
    url: (value: string) => /^(?:https?|ftp|mailto|magnet):/i.test(value) || /^www\./i.test(value),
  },
  render: renderPromptLinkify,
};

const promptHtmlOptions: HTMLReactParserOptions = {
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
      return <Linkify options={PROMPT_LINKIFY_OPTS}>{revealDirectionControls(node.data)}</Linkify>;
    }
    if (!isTag(node)) return undefined;
    const children = domToReact(node.children, promptHtmlOptions);
    switch (node.name) {
      case 'a':
        return node.attribs.href ? (
          <CheckedMessageLink
            href={node.attribs.href}
            rel={node.attribs.rel || 'noreferrer noopener'}
            target={node.attribs.target || '_blank'}
          >
            {children}
          </CheckedMessageLink>
        ) : (
          <>{children}</>
        );
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

const renderPromptContent = (text: string): ReactNode => {
  try {
    const html = sanitizeCustomHtml(
      parseInlineMDWithRules(sanitizeText(text), PROMPT_INLINE_RULES)
    );
    return parse(html, promptHtmlOptions);
  } catch {
    return revealDirectionControls(text);
  }
};

type TriggerWakeMarkerProps = {
  wake: TriggerWakeInfo;
  ts?: number;
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
export function TriggerWakeMarker({ wake, ts }: TriggerWakeMarkerProps) {
  const { t } = useTranslation();
  const [hour24Clock] = useHour24Clock();
  const dateFormatString = useSettingValue(settingsAtom, 'dateFormatString');
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
  const panelId = useId();

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  const summary = summaryParts(wake);
  const source = describeSource(wake);
  const metaItems: ReactNode[] = [];
  if (wake.triggerId) {
    metaItems.push(t(`${KEY}.triggerLabel`, { id: revealDirectionControls(wake.triggerId) }));
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
  const promptContent = useMemo(
    () => (expanded && promptText ? renderPromptContent(promptText) : null),
    [expanded, promptText]
  );
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
          {promptContent && (
            <Text as="p" size="T200" className={css.Prompt} {...ownDirectionBlock}>
              {promptContent}
            </Text>
          )}
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
