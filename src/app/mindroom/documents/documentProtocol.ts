import { type MatrixEvent, type Room } from 'matrix-js-sdk';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';

export const DOCUMENT_CARD_KEY = 'io.mindroom.document';
export const DOCUMENT_EDIT_TOOL_NAME = 'edit_office_document';
/** The backend's approval previews replace secret-looking values with this marker. */
export const REDACTED_MARKER = '***redacted***';

export type DocumentCardEvent = 'connected' | 'saved' | 'edited';
export type DocumentEditOutcome = 'applied' | 'conflict' | 'failed' | 'not_attempted';
export type DocumentChangeStatus = 'applied' | 'partial' | 'conflict' | 'failed';

export type DocumentChangeEdit = {
  range: string;
  outcome: DocumentEditOutcome;
  cellsChanged: number;
  verified?: boolean;
  alreadyApplied: boolean;
};

export type DocumentChange = {
  summary: string;
  status: DocumentChangeStatus;
  verified: boolean;
  cellsChanged: number;
  edits: DocumentChangeEdit[];
};

export type DocumentCard = {
  event: DocumentCardEvent;
  documentId: string;
  name: string;
  kind: 'xlsx';
  webUrl?: string;
  fileUrl?: string;
  location?: string;
  modifiedAt?: string;
  modifiedBy?: string;
  change?: DocumentChange;
};

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined;

/** Accept only plain HTTPS links, so a card can never carry a script or app-scheme URL. */
export const httpsUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
};

const EVENTS: readonly DocumentCardEvent[] = ['connected', 'saved', 'edited'];
const OUTCOMES: readonly DocumentEditOutcome[] = ['applied', 'conflict', 'failed', 'not_attempted'];
const STATUSES: readonly DocumentChangeStatus[] = ['applied', 'partial', 'conflict', 'failed'];

const parseChangeEdit = (value: unknown): DocumentChangeEdit | undefined => {
  if (!record(value) || typeof value.range !== 'string') return undefined;
  const outcome = OUTCOMES.find((item) => item === value.outcome);
  if (!outcome || typeof value.cells_changed !== 'number') return undefined;
  return {
    range: value.range,
    outcome,
    cellsChanged: value.cells_changed,
    verified: typeof value.verified === 'boolean' ? value.verified : undefined,
    alreadyApplied: value.already_applied === true,
  };
};

const parseChange = (value: unknown): DocumentChange | undefined => {
  if (!record(value) || typeof value.summary !== 'string' || !Array.isArray(value.edits)) {
    return undefined;
  }
  const status = STATUSES.find((item) => item === value.status);
  const edits = value.edits.map(parseChangeEdit);
  if (
    !status ||
    typeof value.verified !== 'boolean' ||
    typeof value.cells_changed !== 'number' ||
    edits.some((edit) => !edit)
  ) {
    return undefined;
  }
  return {
    summary: value.summary,
    status,
    verified: value.verified,
    cellsChanged: value.cells_changed,
    edits: edits as DocumentChangeEdit[],
  };
};

/** Parse version 1 card metadata; anything malformed renders as the plain notice instead. */
export const parseDocumentCard = (data: unknown): DocumentCard | undefined => {
  if (!record(data) || data.version !== 1 || data.kind !== 'xlsx') return undefined;
  const event = EVENTS.find((item) => item === data.event);
  const documentId = optionalText(data.document_id);
  const name = optionalText(data.name);
  if (!event || !documentId || !name) return undefined;
  const change = data.change === undefined ? undefined : parseChange(data.change);
  if ((event === 'edited') !== (change !== undefined)) return undefined;
  const revision = record(data.revision) ? data.revision : {};
  return {
    event,
    documentId,
    name,
    kind: 'xlsx',
    webUrl: httpsUrl(data.web_url),
    fileUrl: httpsUrl(data.file_url),
    location: optionalText(data.location),
    modifiedAt: optionalText(revision.modified_at),
    modifiedBy: optionalText(revision.modified_by),
    change,
  };
};

/** Office's documented URI scheme; only built from a validated HTTPS file URL. */
export const excelDesktopUrl = (fileUrl: string | undefined): string | undefined =>
  fileUrl ? `ms-excel:ofe|u|${fileUrl}` : undefined;

/** Read a card only from an unedited notice sent by a joined MindRoom agent on the viewer's homeserver. */
export const readDocumentCard = (
  event: MatrixEvent,
  viewerId: string,
  room: Pick<Room, 'roomId' | 'getMember'>
): DocumentCard | undefined => {
  const sender = event.getSender();
  if (
    !sender ||
    event.getType() !== 'm.room.message' ||
    event.getRoomId() !== room.roomId ||
    event.isRedacted() ||
    event.replacingEventId() ||
    !isMindroomAgentUserIdForViewer(sender, viewerId) ||
    room.getMember(sender)?.membership !== 'join'
  ) {
    return undefined;
  }
  const content = event.getOriginalContent<Record<string, unknown>>();
  const data = content[DOCUMENT_CARD_KEY];
  if (
    content.msgtype !== 'm.notice' ||
    !record(data) ||
    data.agent_user_id !== sender ||
    data.room_id !== room.roomId
  ) {
    return undefined;
  }
  return parseDocumentCard(data);
};

export type DocumentEditCell = string | number | boolean;

export type DocumentEditRequest = {
  range: string;
  before: DocumentEditCell[][];
  after: DocumentEditCell[][];
  /** Per-cell formats; null keeps a cell's current format. */
  numberFormat?: (string | null)[][];
};

export type DocumentEditArguments = {
  documentId?: string;
  summary?: string;
  skipConflicts: boolean;
  edits: DocumentEditRequest[];
};

const rectangular = <T>(
  value: unknown,
  isCell: (cell: unknown) => cell is T
): T[][] | undefined => {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const rows = value.map((row) =>
    Array.isArray(row) && row.every((cell) => isCell(cell)) ? (row as T[]) : undefined
  );
  const width = rows[0]?.length;
  if (!width || rows.some((row) => !row || row.length !== width)) return undefined;
  return rows as T[][];
};

const isEditCell = (cell: unknown): cell is DocumentEditCell =>
  typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean';

const isFormatCell = (cell: unknown): cell is string | null =>
  cell === null || typeof cell === 'string';

const sameShape = (left: unknown[][], right: unknown[][]): boolean =>
  left.length === right.length && left.every((row, index) => row.length === right[index].length);

/** Parse edit_office_document arguments as an approval card shows them, or undefined to fall back to raw JSON. */
export const parseDocumentEditArguments = (
  args: Record<string, unknown>
): DocumentEditArguments | undefined => {
  if (!Array.isArray(args.edits) || args.edits.length === 0) return undefined;
  const edits: DocumentEditRequest[] = [];
  for (const item of args.edits) {
    if (!record(item) || typeof item.range !== 'string') return undefined;
    const before = rectangular(item.before, isEditCell);
    const after = rectangular(item.after, isEditCell);
    if (!before || !after || !sameShape(before, after)) return undefined;
    let numberFormat: (string | null)[][] | undefined;
    if (item.number_format !== undefined && item.number_format !== null) {
      numberFormat = rectangular(item.number_format, isFormatCell);
      if (!numberFormat || !sameShape(numberFormat, after)) return undefined;
    }
    edits.push({ range: item.range, before, after, numberFormat });
  }
  return {
    documentId: optionalText(args.document_id),
    summary: optionalText(args.summary),
    skipConflicts: args.skip_conflicts === true,
    edits,
  };
};

export const isRedactedCell = (value: DocumentEditCell): boolean =>
  typeof value === 'string' && value.includes(REDACTED_MARKER);
