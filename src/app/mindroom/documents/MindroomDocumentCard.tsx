import React, { type ReactNode } from 'react';
import { type MatrixEvent } from 'matrix-js-sdk';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import {
  type DocumentCard,
  type DocumentChange,
  excelDesktopUrl,
  readDocumentCard,
} from './documentProtocol';
import * as css from './MindroomDocuments.css';

const statusPill = (change: DocumentChange): keyof typeof css.Pill => {
  if (change.status === 'applied') return change.verified ? 'good' : 'warn';
  return change.status === 'partial' ? 'warn' : 'bad';
};

function DocumentChangeSummary({ change }: { change: DocumentChange }) {
  const { t } = useTranslation();
  return (
    <div className={css.Change}>
      <Text size="T300">{change.summary}</Text>
      <div className={css.StatusRow}>
        <span className={css.Pill[statusPill(change)]}>
          {t(`mindroomUi.documents.card.status.${change.status}`)}
        </span>
        <Text size="T200">
          {t('mindroomUi.documents.card.cellsChanged', { cells: change.cellsChanged })}
        </Text>
        {change.status !== 'conflict' && change.status !== 'failed' && (
          <Text size="T200">
            {change.verified
              ? t('mindroomUi.documents.card.verified')
              : t('mindroomUi.documents.card.notVerified')}
          </Text>
        )}
      </div>
      {change.edits.some((edit) => edit.outcome !== 'applied' || edit.verified === false) && (
        <ul className={css.OutcomeList}>
          {change.edits.map((edit) => (
            <li key={edit.range}>
              <span className={css.Mono}>{edit.range}</span>{' '}
              {edit.alreadyApplied
                ? t('mindroomUi.documents.card.outcome.alreadyApplied')
                : t(`mindroomUi.documents.card.outcome.${edit.outcome}`)}
              {edit.outcome === 'applied' && edit.verified === false
                ? ` · ${t('mindroomUi.documents.card.notVerified')}`
                : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DocumentCardView({ card }: { card: DocumentCard }) {
  const { t } = useTranslation();
  const modifiedAt = card.modifiedAt ? Date.parse(card.modifiedAt) : Number.NaN;
  const modifiedRelative = useRelativeTime(Number.isFinite(modifiedAt) ? modifiedAt : undefined);
  const desktopUrl = excelDesktopUrl(card.fileUrl);
  return (
    <section className={css.Card} aria-label={t('mindroomUi.documents.card.label')}>
      <div className={css.Header}>
        <span className={css.FileBadge} aria-hidden>
          XLS
        </span>
        <div className={css.Title}>
          <Text className={css.Name} size="T300">
            {card.name}
          </Text>
          <Text className={css.Muted} size="T200">
            {[t(`mindroomUi.documents.card.event.${card.event}`), card.location]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          {card.modifiedBy && (
            <Text className={css.Muted} size="T200">
              {modifiedRelative
                ? t('mindroomUi.documents.card.modifiedByAt', {
                    name: card.modifiedBy,
                    time: modifiedRelative,
                  })
                : t('mindroomUi.documents.card.modifiedBy', { name: card.modifiedBy })}
            </Text>
          )}
        </div>
      </div>
      {card.change && <DocumentChangeSummary change={card.change} />}
      {(desktopUrl || card.webUrl) && (
        <div className={css.Actions}>
          {desktopUrl && (
            <a className={css.PrimaryAction} href={desktopUrl}>
              {t('mindroomUi.documents.card.openInExcel')}
            </a>
          )}
          {card.webUrl && (
            <a className={css.Action} href={card.webUrl} target="_blank" rel="noopener noreferrer">
              {t('mindroomUi.documents.card.openInBrowser')}
            </a>
          )}
        </div>
      )}
    </section>
  );
}

/** Render a validated agent document card, or the plain notice when the event is not one. */
export function MindroomDocumentCard({
  event,
  fallback,
}: {
  event: MatrixEvent;
  fallback: ReactNode;
}) {
  const mx = useMatrixClient();
  const room = mx.getRoom(event.getRoomId());
  const card = room ? readDocumentCard(event, mx.getSafeUserId(), room) : undefined;
  return card ? <DocumentCardView card={card} /> : <>{fallback}</>;
}
