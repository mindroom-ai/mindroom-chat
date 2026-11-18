import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Text, Tooltip, type RectCords } from 'folds';
import { IconNotebook } from '@tabler/icons-react';
import { PopOut, revealDirectionControls } from '../ui/directional';
import { WrapTextIcon } from '../rich-text/code/CodeBlockIcons';
import { CodeBlockAction } from '../rich-text/CustomHtml.css';
import type { SkillReviewFile, SkillReviewNotice } from '../matrix/protocol/skillReview';
import * as css from './SkillReviewMarker.css';

type OpenMode = 'hover' | 'pinned';

const KEY = 'mindroomUi.messages.skillReviewMarker';

function Counts({ file }: { file: SkillReviewFile }) {
  return (
    <>
      <span className={css.Added}>+{file.added}</span>{' '}
      <span className={css.Removed}>−{file.removed}</span>
    </>
  );
}

const diffLineClass = (line: string) => {
  if (line.startsWith('+')) return css.DiffAdded;
  if (line.startsWith('-')) return css.DiffRemoved;
  if (line.startsWith('@@') || line.startsWith('\\')) return css.DiffMeta;
  return css.DiffLine;
};

// One file of the expanded panel. Like a code block, its diff wraps long lines until the reader
// turns wrapping off to scroll them sideways.
function FileDiff({ file }: { file: SkillReviewFile }) {
  const { t } = useTranslation();
  const [wrap, setWrap] = useState(true);
  return (
    <div>
      <Text as="div" size="T200" className={css.FileHeader}>
        <span className={css.FileName}>
          <code>{revealDirectionControls(file.path)}</code> {t(`${KEY}.${file.action}`)}{' '}
          <Counts file={file} />
        </span>
        {file.diff && (
          <button
            type="button"
            className={CodeBlockAction}
            aria-label={t('messageCodeBlock.wrap')}
            title={t('messageCodeBlock.wrap')}
            aria-pressed={wrap}
            onClick={() => setWrap((value) => !value)}
          >
            <WrapTextIcon />
          </button>
        )}
      </Text>
      {file.diff && (
        // Safari does not let the keyboard reach a scroll container on its own, so the
        // named diff is a tab stop (like ScrollableTable).
        <pre
          className={css.Diff}
          dir="ltr"
          data-wrap={wrap}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          role="region"
          aria-label={t(`${KEY}.diffLabel`, { path: file.path })}
        >
          {file.diff
            .replace(/\n$/, '')
            .split('\n')
            .map((line, lineIndex) => (
              // eslint-disable-next-line react/no-array-index-key
              <span key={lineIndex} className={diffLineClass(line)}>
                {revealDirectionControls(line)}
              </span>
            ))}
        </pre>
      )}
      {file.diffTruncated && (
        <Text size="T200" priority="300">
          {t(`${KEY}.diffTruncated`)}
        </Text>
      )}
    </div>
  );
}

// A skill review is the agent's housekeeping, not a reply: one quiet line like the thread title
// marker. A mouse hover lists the changed files; a click opens their diffs below it. A notice
// without files (an older backend) shows its list on a tap instead.
export function SkillReviewMarker({ review }: { review: SkillReviewNotice }) {
  const { t } = useTranslation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [tooltip, setTooltip] = useState<{ mode: OpenMode; anchor: RectCords }>();
  const [expanded, setExpanded] = useState(false);
  const descriptionId = useId();
  const panelId = useId();
  const expandable = review.files.length > 0;

  const show = (mode: OpenMode) => {
    const trigger = triggerRef.current;
    if (trigger) setTooltip({ mode, anchor: trigger.getBoundingClientRect() });
  };

  const tooltipOpen = !!tooltip;
  useEffect(() => {
    if (!tooltipOpen) return undefined;
    const close = () => setTooltip(undefined);
    const onKeyDown = (evt: KeyboardEvent) => {
      if (evt.key === 'Escape') close();
    };
    const onPointerDown = (evt: Event) => {
      if (!triggerRef.current?.contains(evt.target as Node)) close();
    };
    const onScroll = () => {
      const trigger = triggerRef.current;
      if (trigger)
        setTooltip((current) => current && { ...current, anchor: trigger.getBoundingClientRect() });
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [tooltipOpen]);

  const [first] = review.changes;
  const label =
    review.changes.length === 1 && first ? (
      <Trans
        t={t}
        shouldUnescape
        tOptions={{ interpolation: { escapeValue: true } }}
        i18nKey={first.action === 'created' ? `${KEY}.createdOne` : `${KEY}.updatedOne`}
        values={{ skill: revealDirectionControls(first.skill) }}
        components={{ code: <code className={css.Name} /> }}
      />
    ) : (
      t(
        review.changes.every((change) => change.action === 'created')
          ? `${KEY}.createdMany`
          : `${KEY}.updatedMany`,
        { count: review.changes.length }
      )
    );

  const details = expandable
    ? review.files.map((file, index) => (
        <li key={`${index}:${file.path}`}>
          <code>{revealDirectionControls(file.path)}</code> {t(`${KEY}.${file.action}`)}{' '}
          <Counts file={file} />
        </li>
      ))
    : review.changes.map((change) => (
        <li key={change.skill}>
          <code>{revealDirectionControls(change.skill)}</code> {t(`${KEY}.${change.action}`)}
        </li>
      ));

  return (
    <div className={css.Marker} data-skill-review="true">
      <button
        ref={triggerRef}
        type="button"
        className={css.MarkerTrigger}
        aria-expanded={expandable ? expanded : tooltipOpen}
        aria-controls={expandable ? panelId : undefined}
        aria-describedby={descriptionId}
        onPointerEnter={(evt: PointerEvent) => {
          if (evt.pointerType === 'mouse' && !tooltip && !expanded) show('hover');
        }}
        onPointerLeave={(evt: PointerEvent) => {
          if (evt.pointerType === 'mouse' && tooltip?.mode === 'hover') setTooltip(undefined);
        }}
        onClick={() => {
          if (expandable) {
            setTooltip(undefined);
            setExpanded((open) => !open);
          } else if (tooltip?.mode === 'pinned') setTooltip(undefined);
          else show('pinned');
        }}
        onBlur={() => setTooltip(undefined)}
      >
        <IconNotebook size={14} aria-hidden />
        <Text as="span" size="T200" className={`${css.Name} ${css.Label}`}>
          {label}
        </Text>
      </button>
      <ul id={descriptionId} hidden>
        {details}
      </ul>
      {/* Like the thread title marker: the PopOut layer lets the pointer through, and the
          tooltip inside, not the layer, has the role. */}
      <PopOut
        style={{ pointerEvents: 'none' }}
        anchor={tooltip?.anchor}
        position="Top"
        align="Start"
        offset={4}
        content={
          <Tooltip role="tooltip">
            <Text as="ul" size="T200" className={css.Details}>
              {details}
            </Text>
          </Tooltip>
        }
      />
      {expandable && expanded && (
        <div id={panelId} className={css.Panel} data-skill-review-diff="true">
          {review.files.map((file, index) => (
            <FileDiff key={`${index}:${file.path}`} file={file} />
          ))}
        </div>
      )}
    </div>
  );
}
