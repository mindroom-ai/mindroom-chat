import React from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../locales/en.json';
import { parseToolApprovalContent } from '../messages/toolApproval';
import { ApprovalDocumentEditReview, cellAddress, changedCells } from './DocumentEditReview';
import { DocumentCardView } from './MindroomDocumentCard';
import { parseDocumentCard } from './documentProtocol';

vi.mock('../../hooks/useRelativeTime', () => ({ useRelativeTime: () => '5 minutes ago' }));
vi.mock('./MindroomDocuments.css', () => ({
  ...Object.fromEntries(
    [
      'Card',
      'Header',
      'FileBadge',
      'Title',
      'Name',
      'Muted',
      'Change',
      'StatusRow',
      'OutcomeList',
      'Mono',
      'Actions',
      'Action',
      'PrimaryAction',
      'Review',
      'ReviewEdit',
      'DiffTable',
      'DiffHead',
      'DiffCell',
      'Old',
      'New',
      'Redacted',
    ].map((name) => [name, name])
  ),
  Pill: { good: 'good', warn: 'warn', bad: 'bad' },
}));

const i18n = createInstance();
void i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

let renderer: ReactTestRenderer;
afterEach(() => act(() => renderer?.unmount()));

const render = (node: React.ReactNode) => {
  act(() => {
    renderer = create(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
  });
  return renderer;
};

const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());

const card = (overrides: Record<string, unknown> = {}) =>
  parseDocumentCard({
    version: 1,
    event: 'edited',
    document_id: 'b!drive:01ITEM',
    name: 'Forecast.xlsx',
    kind: 'xlsx',
    web_url: 'https://contoso.sharepoint.com/sites/finance/_layouts/15/Doc.aspx?sourcedoc=%7BA1%7D',
    file_url: 'https://contoso.sharepoint.com/sites/finance/Shared%20Documents/Forecast.xlsx',
    location: 'FY27',
    revision: { modified_at: '2026-09-25T10:05:40Z', modified_by: 'Sam Kim' },
    change: {
      summary: 'Raise growth to 12%',
      status: 'partial',
      verified: false,
      cells_changed: 1,
      edits: [
        { range: 'Assumptions!B4', outcome: 'conflict', cells_changed: 0 },
        { range: "'Summary Sheet'!B2", outcome: 'applied', cells_changed: 1, verified: false },
      ],
    },
    ...overrides,
  })!;

const approval = (args: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  parseToolApprovalContent('io.mindroom.tool_approval', {
    approval_id: 'one',
    tool_name: 'edit_office_document',
    agent_name: 'analyst',
    status: 'pending',
    arguments: args,
    requested_at: '2026-09-25T10:00:00Z',
    expires_at: '2026-09-25T11:00:00Z',
    ...extra,
  })!;

describe('document card', () => {
  it('shows the file, change outcome, and Office links', () => {
    const tree = render(<DocumentCardView card={card()} />);
    const links = tree.root.findAllByType('a');

    expect(links.map((link) => link.props.href)).toEqual([
      'ms-excel:ofe|u|https://contoso.sharepoint.com/sites/finance/Shared%20Documents/Forecast.xlsx',
      'https://contoso.sharepoint.com/sites/finance/_layouts/15/Doc.aspx?sourcedoc=%7BA1%7D',
    ]);
    expect(links[1].props.rel).toBe('noopener noreferrer');
    const output = text(tree);
    expect(output).toContain('Forecast.xlsx');
    expect(output).toContain('Edited · FY27');
    expect(output).toContain('Last modified by Sam Kim 5 minutes ago');
    expect(output).toContain('Partially applied');
    expect(output).toContain('changed since it was read, skipped');
    expect(output).toContain('Not verified');
  });

  it('omits actions without links and outcome lists for clean applies', () => {
    const tree = render(
      <DocumentCardView
        card={card({
          web_url: undefined,
          file_url: undefined,
          change: {
            summary: 'Raise growth',
            status: 'applied',
            verified: true,
            cells_changed: 1,
            edits: [
              { range: 'Assumptions!B4', outcome: 'applied', cells_changed: 1, verified: true },
            ],
          },
        })}
      />
    );
    expect(tree.root.findAllByType('a')).toHaveLength(0);
    expect(tree.root.findAllByType('ul')).toHaveLength(0);
    expect(text(tree)).toContain('Verified');
  });
});

describe('document edit review', () => {
  const args = {
    document_id: 'b!drive:01ITEM',
    summary: 'Raise growth to 12%',
    edits: [
      {
        range: 'Assumptions!B4:C5',
        before: [
          [0.08, 'Sam'],
          [142, '***redacted***'],
        ],
        after: [
          [0.12, 'Sam'],
          [142, '***redacted***'],
        ],
        number_format: [
          ['0%', 'General'],
          ['0', 'General'],
        ],
      },
    ],
  };

  it('names each changed cell from the range origin', () => {
    expect(cellAddress("'Summary Sheet'!Z9:AA10", 1, 1)).toBe('AA10');
    const { changed, unchanged } = changedCells({
      range: 'Assumptions!B4:C4',
      before: [[1, 2]],
      after: [[1, 3]],
    });
    expect(changed.map((cell) => cell.address)).toEqual(['C4']);
    expect(unchanged).toBe(1);
  });

  it('renders changed cells, formats, and the redaction note from complete arguments', () => {
    const output = text(render(<ApprovalDocumentEditReview approval={approval(args)} />));
    expect(output).toContain('Raise growth to 12%');
    expect(output).toContain('B4');
    expect(output).toContain('0.12');
    expect(output).toContain('format 0%');
    expect(output).toContain('hidden');
    expect(output).toContain(
      'Some values are hidden in this preview because they look like secrets.'
    );
  });

  it('prefers full arguments and hides the review when only a truncated preview exists', () => {
    const truncated = approval({ preview: 'x' }, { arguments_truncated: true });
    expect(render(<ApprovalDocumentEditReview approval={truncated} />).toJSON()).toBeNull();
    const full = approval({ preview: 'x' }, { arguments_truncated: true, full_arguments: args });
    expect(text(render(<ApprovalDocumentEditReview approval={full} />))).toContain('B4');
  });

  it('renders nothing for other tools or malformed edits', () => {
    const other = parseToolApprovalContent('io.mindroom.tool_approval', {
      approval_id: 'two',
      tool_name: 'shell',
      agent_name: 'analyst',
      status: 'pending',
      arguments: args,
      requested_at: '2026-09-25T10:00:00Z',
      expires_at: '2026-09-25T11:00:00Z',
    })!;
    expect(render(<ApprovalDocumentEditReview approval={other} />).toJSON()).toBeNull();
    const malformed = approval({ edits: [{ range: 'A!A1', before: [[1]], after: [[1, 2]] }] });
    expect(render(<ApprovalDocumentEditReview approval={malformed} />).toJSON()).toBeNull();
  });
});
