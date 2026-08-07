/**
 * Guards React's commit phase against third parties that reparent DOM nodes
 * React owns.
 *
 * Google Translate (and some browser extensions) rewrite text nodes in place:
 * the original node is moved into an injected `<font>` wrapper. React still
 * holds the old node and calls `parent.removeChild(node)` on the next commit,
 * which throws `NotFoundError: Failed to execute 'removeChild' on 'Node'` and
 * takes the whole app down through the router error boundary. Streaming
 * MindRoom replies commit constantly, so a translated thread crashes fast.
 *
 * The `notranslate` markers in `index.html` stop Chrome's own translator and
 * are the actual fix for the reported crash. This guard is a second layer for
 * extensions that ignore those markers — Grammarly and similar rewriters
 * reparent nodes the same way. No such report exists yet, so treat this as
 * defense in depth rather than a fix, and weigh it against the cost of
 * patching a global prototype.
 */

const GUARD_FLAG = '__mindroomDomMutationGuard';

type GuardedNodePrototype = typeof Node.prototype & {
  [GUARD_FLAG]?: boolean;
};

/**
 * Walks up from `node` to the child of `parent` that contains it, which is the
 * injected `<font>` wrapper in the translation case. Returns null when `node`
 * is not inside `parent` at all.
 */
const childOfContaining = (parent: Node, node: Node): Node | null => {
  let candidate: Node | null = node;
  while (candidate && candidate.parentNode !== parent) candidate = candidate.parentNode;
  return candidate;
};

let reportedMismatch = false;

const reportOnce = (operation: string, parent: Node, child: Node): void => {
  if (reportedMismatch) return;
  reportedMismatch = true;
  // Swallowing the mismatch hides genuine app-side DOM bugs too, so leave one
  // breadcrumb per session for whoever debugs the next report.
  // eslint-disable-next-line no-console
  console.warn(
    `[MindRoom Chat] Ignored ${operation} on a reparented node — the DOM was mutated ` +
      `outside React (translation or extension). parent=<${parent.nodeName.toLowerCase()}> ` +
      `child=<${child.nodeName.toLowerCase()}>`
  );
};

/**
 * Patches `removeChild`/`insertBefore` so a wrong-parent call recovers instead
 * of throwing. Idempotent; returns an uninstall function.
 */
export const installDomMutationGuard = (): (() => void) => {
  const proto = Node.prototype as GuardedNodePrototype;
  if (proto[GUARD_FLAG]) return () => undefined;

  const originalRemoveChild = proto.removeChild;
  const originalInsertBefore = proto.insertBefore;

  proto.removeChild = function guardedRemoveChild<T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      reportOnce('removeChild', this, child);
      // React owns this node and wants it gone, so detach it from wherever the
      // translator moved it. Returning early instead would leave superseded
      // reply text on screen for the rest of the session. This re-enters the
      // patch once, and then takes the branch below.
      child.parentNode?.removeChild(child);
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  proto.insertBefore = function guardedInsertBefore<T extends Node>(
    this: Node,
    node: T,
    referenceNode: Node | null
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      reportOnce('insertBefore', this, referenceNode);
      // The translator merges a whole inline run into one <font>, so the anchor
      // usually sits mid-wrapper. Insert at the anchor inside its real parent;
      // inserting before the wrapper would jump the node to the front of the
      // run.
      const realParent = referenceNode.parentNode;
      if (realParent && this.contains(realParent)) {
        return originalInsertBefore.call(realParent, node, referenceNode) as T;
      }
      // The anchor left this parent but an ancestor of it is still ours, so
      // fall back to that boundary, then to appending.
      const anchor = childOfContaining(this, referenceNode);
      if (anchor) return originalInsertBefore.call(this, node, anchor) as T;
      return this.appendChild(node);
    }
    return originalInsertBefore.call(this, node, referenceNode) as T;
  };

  // Plain assignment would put an enumerable marker on the global Node
  // prototype, exposing it to every `for...in` over a DOM node in the app.
  Object.defineProperty(proto, GUARD_FLAG, { value: true, configurable: true });

  return () => {
    proto.removeChild = originalRemoveChild;
    proto.insertBefore = originalInsertBefore;
    delete proto[GUARD_FLAG];
    reportedMismatch = false;
  };
};
