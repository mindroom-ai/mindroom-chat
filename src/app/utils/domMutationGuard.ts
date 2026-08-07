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
 * `index.html` marks the document `notranslate`, which stops Chrome's own
 * translator. This guard is the second layer, for extensions that ignore it:
 * a parent mismatch degrades to a no-op instead of an unmounted app.
 */

type GuardedNodePrototype = typeof Node.prototype & {
  __mindroomDomMutationGuard?: boolean;
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
 * Patches `removeChild`/`insertBefore` so a wrong-parent call is ignored
 * instead of throwing. Idempotent; returns an uninstall function.
 */
export const installDomMutationGuard = (): (() => void) => {
  const proto = Node.prototype as GuardedNodePrototype;
  if (proto.__mindroomDomMutationGuard) return () => undefined;

  const originalRemoveChild = proto.removeChild;
  const originalInsertBefore = proto.insertBefore;

  proto.removeChild = function guardedRemoveChild<T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      reportOnce('removeChild', this, child);
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
      // The anchor is gone from this parent; appending keeps the node in the
      // tree so React's next commit can still find and update it.
      return this.appendChild(node);
    }
    return originalInsertBefore.call(this, node, referenceNode) as T;
  };

  proto.__mindroomDomMutationGuard = true;

  return () => {
    proto.removeChild = originalRemoveChild;
    proto.insertBefore = originalInsertBefore;
    delete proto.__mindroomDomMutationGuard;
    reportedMismatch = false;
  };
};
