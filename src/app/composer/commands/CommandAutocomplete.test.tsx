import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEditor, type Descendant, Editor, Transforms } from 'slate';
import { toPlainText } from '../../editor/output';
import { getPrevWorldRange } from '../../editor/utils';
import {
  AUTOCOMPLETE_PREFIXES,
  type AutocompleteQuery,
  getAutocompleteQuery,
} from '../../editor/autocomplete/autocompleteQuery';
import { getAgentCommandQuery } from './agentCommandQuery';
import { AgentCommandAutocomplete, CommandAutocomplete } from './CommandAutocomplete';
import { defined } from '../../../test/utils/defined';

vi.mock('../../editor/autocomplete/AutocompleteMenu', () => ({
  AutocompleteMenu: ({
    headerContent,
    children,
  }: {
    headerContent: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      {headerContent}
      {children}
    </div>
  ),
}));
vi.mock('../../ui/glass/GlassPrimitives', () => ({
  MenuItem: ({
    children,
    after,
    onClick,
    'data-slash-command': slashCommand,
  }: {
    children: React.ReactNode;
    after?: React.ReactNode;
    onClick: () => void;
    'data-slash-command'?: string;
  }) => (
    <button type="button" data-slash-command={slashCommand} onClick={onClick}>
      {children}
      {after}
    </button>
  ),
}));

const SLASH_COMMANDS = [
  { name: 'me', description: 'Sends an action.' },
  { name: 'shrug', description: 'Puts a shrug before the message.' },
  { name: 'shout', description: 'Says it louder.' },
];

const originalWindow = globalThis.window;
const windowKeyDown: { listener?: (event: unknown) => void } = {};
let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  // The menu listens on the window for Tab and Enter while the caret stays in the composer.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: (_type: string, listener: (event: unknown) => void) => {
        windowKeyDown.listener = listener;
      },
      removeEventListener: () => {
        windowKeyDown.listener = undefined;
      },
    },
  });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  windowKeyDown.listener = undefined;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

/** An editor holding `text` with the caret at its end, and the query for the word there. */
const editorWith = (text: string) => {
  const editor = createEditor();
  editor.children = [{ type: 'paragraph', children: [{ text }] }] as Descendant[];
  Transforms.select(editor, Editor.end(editor, []));
  const range = defined(getPrevWorldRange(editor), `a word in ${text}`);
  const query: AutocompleteQuery<string> | undefined = text.startsWith('!')
    ? getAgentCommandQuery(editor, range)
    : getAutocompleteQuery(editor, range, AUTOCOMPLETE_PREFIXES);
  return { editor, query: defined(query, `a query in ${text}`), requestClose: vi.fn() };
};

const renderSlashMenu = (text: string) => {
  const { editor, query, requestClose } = editorWith(text);
  act(() => {
    renderer = create(
      <CommandAutocomplete
        editor={editor}
        query={query}
        title="Commands"
        commands={SLASH_COMMANDS}
        requestClose={requestClose}
      />
    );
  });
  return { editor, requestClose };
};

type Node = ReactTestRenderer['root'];

const rows = () => renderer!.root.findAllByType('button');
/** The text of the elements under `node`, in order. */
const texts = (node: Node): unknown[] =>
  node
    .findAll((child) => typeof child.type === 'string' && typeof child.props.children === 'string')
    .map((child) => child.props.children);

it('lists the commands that start with the typed letters, each with what it does', () => {
  renderSlashMenu('/SH');

  expect(rows().map(texts)).toEqual([
    ['/shrug', 'Puts a shrug before the message.'],
    ['/shout', 'Says it louder.'],
  ]);
  expect(rows().map((row) => row.props['data-slash-command'])).toEqual(['shrug', 'shout']);
});

it('writes the picked command and a space in place of the typed word', () => {
  const { editor, requestClose } = renderSlashMenu('/shr');

  act(() => {
    defined(rows()[0], 'a command row').props.onClick();
  });

  expect(toPlainText(editor.children, false)).toBe('/shrug ');
  expect(requestClose).toHaveBeenCalled();
});

it('takes the first command on Tab in the composer', () => {
  const { editor } = renderSlashMenu('/sh');
  const tab = {
    key: 'Tab',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
  };

  act(() => defined(windowKeyDown.listener, 'the window key listener')(tab));

  expect(tab.preventDefault).toHaveBeenCalled();
  expect(toPlainText(editor.children, false)).toBe('/shrug ');
});

it('shows nothing when no command starts with the typed letters', () => {
  renderSlashMenu('/zz');

  expect(renderer!.toJSON()).toBeNull();
  expect(windowKeyDown.listener).toBeUndefined();
});

it("lists MindRoom's commands with their syntax, and a pick writes the ! command", () => {
  const { editor, query, requestClose } = editorWith('!sched');
  act(() => {
    renderer = create(
      <AgentCommandAutocomplete editor={editor} query={query} requestClose={requestClose} />
    );
  });

  expect(texts(renderer!.root)).toContain('MindRoom Commands');
  expect(rows().map(texts)).toEqual([['!schedule <task>', 'Schedule a task for later execution.']]);
  expect(rows()[0]?.props['data-slash-command']).toBeUndefined();

  act(() => {
    defined(rows()[0], 'a command row').props.onClick();
  });

  expect(toPlainText(editor.children, false)).toBe('!schedule ');
  expect(requestClose).toHaveBeenCalled();
});
