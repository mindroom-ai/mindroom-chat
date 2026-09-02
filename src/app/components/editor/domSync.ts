import { useEffect } from 'react';
import { Editor, Node, Path, Range, Text, Transforms } from 'slate';
import { IS_ANDROID } from 'slate-dom';
import { ReactEditor, useSlateStatic } from 'slate-react';

export type DesyncedLeaf = {
  path: Path;
  domText: string;
};

const ZERO_WIDTH_PATTERN = /\uFEFF/g;

const isIgnoredTextContainer = (element: Element): boolean =>
  element.hasAttribute('data-slate-placeholder') ||
  element.getAttribute('contenteditable') === 'false';

const hasIgnoredAncestor = (node: globalThis.Node, root: Element): boolean => {
  let ancestor = node.parentElement;
  while (ancestor && ancestor !== root) {
    if (isIgnoredTextContainer(ancestor)) return true;
    ancestor = ancestor.parentElement;
  }
  return false;
};

/**
 * Collect the text the user actually sees inside a Slate text leaf element,
 * skipping placeholder text, non-editable decorations and Slate's zero-width
 * bookkeeping characters. A `<br>` the browser inserted natively counts as a
 * newline; the `<br>` Slate itself renders inside zero-width spans does not.
 */
const readVisibleLeafText = (leafElement: HTMLElement): string => {
  const doc = leafElement.ownerDocument;
  const walker = doc.createTreeWalker(leafElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      if (node.nodeType === globalThis.Node.ELEMENT_NODE) {
        if (isIgnoredTextContainer(node as Element)) return NodeFilter.FILTER_REJECT;
        return (node as Element).tagName === 'BR'
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === globalThis.Node.ELEMENT_NODE) {
      if (!(node.parentElement && node.parentElement.hasAttribute('data-slate-zero-width'))) {
        text += '\n';
      }
    } else {
      text += node.textContent ?? '';
    }
  }
  return text.replace(ZERO_WIDTH_PATTERN, '');
};

/**
 * Find Slate text leaves whose rendered DOM text no longer matches the editor
 * model. This happens when the browser inserts text natively without Slate
 * intercepting the `beforeinput` event (for example a paste that fell through
 * to the browser), leaving text visible that the editor does not know about.
 */
export const findDesyncedLeaves = (editor: Editor, editable: HTMLElement): DesyncedLeaf[] => {
  const desynced: DesyncedLeaf[] = [];
  editable.querySelectorAll<HTMLElement>('[data-slate-node="text"]').forEach((leafElement) => {
    let slateNode: Node;
    try {
      slateNode = ReactEditor.toSlateNode(editor, leafElement);
    } catch {
      return;
    }
    if (!Text.isText(slateNode)) return;
    let path: Path;
    try {
      path = ReactEditor.findPath(editor, slateNode);
    } catch {
      return;
    }
    // The element map may still point at a node object from before the last
    // model change, so compare against the current node at that path.
    if (!Node.has(editor, path)) return;
    const currentNode = Node.get(editor, path);
    if (!Text.isText(currentNode)) return;
    const modelText = currentNode.text;
    let domText = readVisibleLeafText(leafElement);
    // slate-react renders one extra trailing newline for the last leaf of a
    // block that ends in a soft break, so browsers do not collapse it.
    if (modelText.endsWith('\n') && domText === `${modelText}\n`) {
      domText = modelText;
    }
    if (domText === modelText) return;
    desynced.push({ path, domText });
  });
  return desynced;
};

/**
 * True when the editable contains visible text that is not inside any Slate
 * text leaf, for example new lines the browser split into its own elements
 * during a native multi-line paste. Such text cannot be mapped back into the
 * model safely, so callers only report it.
 */
export const hasTextOutsideLeaves = (editable: HTMLElement): boolean => {
  const walker = editable.ownerDocument.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(ZERO_WIDTH_PATTERN, '');
    if (text.trim() === '') continue;
    if (node.parentElement?.closest('[data-slate-node="text"]')) continue;
    if (hasIgnoredAncestor(node, editable)) continue;
    return true;
  }
  return false;
};

const caretFromDom = (editor: Editor, path: Path): Range | null => {
  let domSelection: Selection | null = null;
  try {
    domSelection = ReactEditor.getWindow(editor).getSelection();
  } catch {
    return null;
  }
  if (!domSelection || domSelection.rangeCount === 0 || !domSelection.isCollapsed) return null;
  const range = ReactEditor.toSlateRange(editor, domSelection, {
    exactMatch: false,
    suppressThrow: true,
  });
  if (!range || !Path.equals(range.anchor.path, path)) return null;
  const length = Node.string(Node.get(editor, path)).length;
  if (range.anchor.offset > length) return null;
  return range;
};

/**
 * Replace the model text of each desynced leaf with what the DOM shows. The
 * caret stays where the browser left it when that position can be mapped,
 * otherwise it moves to the end of the last repaired leaf. Returns the number
 * of leaves repaired.
 */
export const repairDesyncedLeaves = (editor: Editor, leaves: DesyncedLeaf[]): number => {
  if (leaves.length === 0) return 0;
  let repaired = 0;
  let lastRepaired: Path | undefined;
  Editor.withoutNormalizing(editor, () => {
    leaves.forEach(({ path, domText }) => {
      if (!Node.has(editor, path)) return;
      const node = Node.get(editor, path);
      if (!Text.isText(node)) return;
      Transforms.insertText(editor, domText, { at: Editor.range(editor, path) });
      lastRepaired = path;
      repaired += 1;
    });
  });
  if (lastRepaired && Node.has(editor, lastRepaired)) {
    Transforms.select(
      editor,
      caretFromDom(editor, lastRepaired) ?? Editor.end(editor, lastRepaired)
    );
  }
  return repaired;
};

/**
 * Watch the editable for native `input` events that mutated the DOM without
 * going through Slate, and fold the visible text back into the model so the
 * composer never ends up showing text it cannot send, edit or copy.
 */
export const useDomSyncGuard = (): void => {
  const editor = useSlateStatic();

  useEffect(() => {
    // On Android slate-react cannot cancel `beforeinput`; it lets the DOM
    // mutate and reconciles pending diffs itself on a timer. Repairing in
    // parallel would apply the same text twice, so stay out of the way there.
    if (IS_ANDROID) return undefined;
    let editable: HTMLElement;
    try {
      editable = ReactEditor.toDOMNode(editor, editor);
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[MindRoom Chat] Composer DOM sync guard could not find the editable element.');
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onInput = (event: Event) => {
      const inputEvent = event as InputEvent;
      // IME compositions legitimately keep DOM text ahead of the model until
      // compositionend; Slate reconciles those itself.
      if (inputEvent.isComposing) return;
      if (timer !== undefined) clearTimeout(timer);
      // Let slate-react finish its own handling of this event (deferred
      // native operations run in its React `onInput`) before inspecting.
      timer = setTimeout(() => {
        timer = undefined;
        const leaves = findDesyncedLeaves(editor, editable);
        const repaired = repairDesyncedLeaves(editor, leaves);
        const strayText = hasTextOutsideLeaves(editable);
        if (repaired === 0 && !strayText) return;
        // eslint-disable-next-line no-console
        console.warn('[MindRoom Chat] Composer text was inserted outside the editor model.', {
          inputType: inputEvent.inputType,
          repaired,
          leaves,
          strayText,
        });
      }, 0);
    };

    editable.addEventListener('input', onInput);
    return () => {
      editable.removeEventListener('input', onInput);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [editor]);
};
