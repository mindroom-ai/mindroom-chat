import React from 'react';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { type ToolApprovalData } from '../messages/toolApproval';
import {
  DOCUMENT_EDIT_TOOL_NAME,
  type DocumentEditCell,
  type DocumentEditRequest,
  cellsEqual,
  isRedactedCell,
  parseDocumentEditArguments,
} from './documentProtocol';
import * as css from './MindroomDocuments.css';

const CELL_PATTERN = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})/;

const columnNumber = (letters: string): number =>
  [...letters.toUpperCase()].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);

const columnLetters = (value: number): string => {
  let number = value;
  let letters = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    number = Math.floor((number - 1) / 26);
  }
  return letters;
};

/** Name each cell of an edit, such as B4, from the range's top-left cell. */
export const cellAddress = (range: string, row: number, column: number): string => {
  const address = range.slice(range.lastIndexOf('!') + 1);
  const match = CELL_PATTERN.exec(address);
  if (!match) return `${row + 1}:${column + 1}`;
  return `${columnLetters(columnNumber(match[1]) + column)}${Number(match[2]) + row}`;
};

type ChangedCell = {
  address: string;
  before: DocumentEditCell;
  after: DocumentEditCell;
  format?: string;
};

export const changedCells = (
  edit: DocumentEditRequest
): { changed: ChangedCell[]; unchanged: number } => {
  const changed: ChangedCell[] = [];
  let unchanged = 0;
  edit.after.forEach((row, rowIndex) =>
    row.forEach((after, columnIndex) => {
      const before = edit.before[rowIndex][columnIndex];
      const format = edit.numberFormat?.[rowIndex][columnIndex];
      if (cellsEqual(before, after) && format === undefined) {
        unchanged += 1;
        return;
      }
      changed.push({
        address: cellAddress(edit.range, rowIndex, columnIndex),
        before,
        after,
        format,
      });
    })
  );
  return { changed, unchanged };
};

function CellValue({ value, className }: { value: DocumentEditCell; className: string }) {
  const { t } = useTranslation();
  if (isRedactedCell(value)) {
    return <span className={css.Redacted}>{t('mindroomUi.documents.review.hidden')}</span>;
  }
  if (value === '') {
    return <span className={css.Redacted}>{t('mindroomUi.documents.review.empty')}</span>;
  }
  return <span className={className}>{String(value)}</span>;
}

function EditDiff({ edit }: { edit: DocumentEditRequest }) {
  const { t } = useTranslation();
  const { changed, unchanged } = changedCells(edit);
  return (
    <div className={css.ReviewEdit}>
      <Text size="T200" className={css.Mono}>
        {edit.range}
      </Text>
      {changed.length > 0 && (
        <table className={css.DiffTable}>
          <thead>
            <tr>
              <th className={css.DiffHead}>{t('mindroomUi.documents.review.cell')}</th>
              <th className={css.DiffHead}>{t('mindroomUi.documents.review.before')}</th>
              <th className={css.DiffHead}>{t('mindroomUi.documents.review.after')}</th>
            </tr>
          </thead>
          <tbody>
            {changed.map((cell) => (
              <tr key={cell.address}>
                <td className={`${css.DiffCell} ${css.Mono}`}>{cell.address}</td>
                <td className={css.DiffCell}>
                  <CellValue value={cell.before} className={css.Old} />
                </td>
                <td className={css.DiffCell}>
                  <CellValue value={cell.after} className={css.New} />
                  {cell.format !== undefined && (
                    <span className={css.Muted}>
                      {' '}
                      {t('mindroomUi.documents.review.format', { format: cell.format })}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unchanged > 0 && (
        <Text size="T200" className={css.Muted}>
          {t('mindroomUi.documents.review.unchanged', { cells: unchanged })}
        </Text>
      )}
    </div>
  );
}

/** Before/after review for edit_office_document; renders nothing when the arguments cannot be read safely. */
export function DocumentEditReview({ args }: { args: Record<string, unknown> }) {
  const { t } = useTranslation();
  const parsed = parseDocumentEditArguments(args);
  if (!parsed) return null;
  const redacted = parsed.edits.some((edit) =>
    [...edit.before, ...edit.after].some((row) => row.some(isRedactedCell))
  );
  return (
    <div className={css.Review} aria-label={t('mindroomUi.documents.review.label')}>
      {parsed.summary && <Text size="T300">{parsed.summary}</Text>}
      {parsed.edits.map((edit) => (
        <EditDiff key={edit.range} edit={edit} />
      ))}
      {parsed.skipConflicts && (
        <Text size="T200" className={css.Muted}>
          {t('mindroomUi.documents.review.skipConflicts')}
        </Text>
      )}
      {redacted && (
        <Text size="T200" className={css.Muted}>
          {t('mindroomUi.documents.review.redactedNote')}
        </Text>
      )}
      <Text size="T200" className={css.Muted}>
        {t('mindroomUi.documents.review.conflictNote')}
      </Text>
    </div>
  );
}

/** Show the review only from complete arguments; a truncated preview could misstate what will be written. */
export function ApprovalDocumentEditReview({ approval }: { approval: ToolApprovalData }) {
  if (approval.toolName !== DOCUMENT_EDIT_TOOL_NAME) return null;
  const args =
    approval.fullArguments ?? (approval.argumentsTruncated ? undefined : approval.arguments);
  return args ? <DocumentEditReview args={args} /> : null;
}
