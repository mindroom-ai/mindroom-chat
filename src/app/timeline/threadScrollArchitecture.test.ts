import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SCANNED_DIRS = ['src/app/timeline', 'src/app/threads'];
const OWNER_FUNNEL_FILE = 'src/app/timeline/threadScrollWriter.ts';

/**
 * Frozen inventory of legacy room/flag-off scroll write sites and non-timeline UI
 * helpers. Any new or moved scroll write in thread or timeline code outside
 * `threadScrollWriter.ts` fails this architecture test immediately.
 */
const LEGACY_SCROLL_WRITE_ALLOWLIST: Record<string, number> = {
  // Shared room + legacy flag-off thread files (gated off when thread scroll owner is enabled).
  'src/app/timeline/clampedScrollCorrection.ts': 1,
  'src/app/timeline/roomFocusScrollController.ts': 4,
  'src/app/timeline/roomTimelineScroll.ts': 8,
  'src/app/timeline/timelineScrollLedgerController.ts': 4,
  'src/app/timeline/useFollowContentGrowth.ts': 1,
  'src/app/timeline/useFooterBottomPin.ts': 1,
  'src/app/timeline/useListEndClamp.ts': 1,
  'src/app/timeline/useTimelineBulkExpansionAnchor.ts': 2,
  'src/app/timeline/useVirtualPaginator.ts': 3,
  // Non-timeline UI scrollers (Compact overview fallback and filter dropdown menu).
  'src/app/threads/overview/useCompactScrollFallback.ts': 1,
  'src/app/threads/overview/ThreadFilterDropdown.tsx': 2,
};

const SCROLL_METHODS = new Set(['scrollTo', 'scrollBy', 'scrollToIndex']);
const SCROLL_HELPERS = new Set(['scrollToBottom', 'scrollToLatestEnd']);
const SCROLL_TOP_ASSIGN_OPS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
]);

type WriteFinding = { kind: string; line: number };
type VirtualizerFinding = { line: number; reason: string };

const isTestFile = (relPath: string): boolean =>
  /\.test(?:\.[^.]+)?\.[tj]sx?$/.test(relPath) || relPath.includes('/test-utils/');

const collectSourceFiles = (dir: string): string[] => {
  const absDir = path.join(REPO_ROOT, dir);
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.[tj]sx?$/.test(entry.name)) {
        const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
        if (!isTestFile(rel)) out.push(rel);
      }
    }
  };
  walk(absDir);
  return out.sort();
};

const lineOf = (source: ts.SourceFile, node: ts.Node): number =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

const findScrollWritesInSource = (fileName: string, content: string): WriteFinding[] => {
  const source = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const findings: WriteFinding[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      SCROLL_TOP_ASSIGN_OPS.has(node.operatorToken.kind) &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'scrollTop'
    ) {
      findings.push({ kind: 'scrollTop=', line: lineOf(source, node) });
    } else if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        SCROLL_METHODS.has(node.expression.name.text)
      ) {
        findings.push({ kind: node.expression.name.text, line: lineOf(source, node) });
      } else if (ts.isIdentifier(node.expression) && SCROLL_HELPERS.has(node.expression.text)) {
        findings.push({ kind: node.expression.text, line: lineOf(source, node) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
};

const isNoopScrollToFnValue = (expr: ts.Expression): boolean => {
  if (ts.isIdentifier(expr) && expr.text === 'NOOP_THREAD_SCROLL_TO_FN') return true;
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    if (ts.isBlock(expr.body) && expr.body.statements.length === 0) return true;
    if (ts.isIdentifier(expr.body) && expr.body.text === 'undefined') return true;
  }
  return false;
};

const objectHasNoopScrollToFn = (obj: ts.ObjectLiteralExpression): boolean => {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'scrollToFn' &&
      isNoopScrollToFnValue(prop.initializer)
    ) {
      return true;
    }
    if (ts.isSpreadAssignment(prop)) {
      const expr = ts.isParenthesizedExpression(prop.expression)
        ? prop.expression.expression
        : prop.expression;
      if (ts.isConditionalExpression(expr)) {
        if (
          (ts.isObjectLiteralExpression(expr.whenTrue) && objectHasNoopScrollToFn(expr.whenTrue)) ||
          (ts.isObjectLiteralExpression(expr.whenFalse) && objectHasNoopScrollToFn(expr.whenFalse))
        ) {
          return true;
        }
      } else if (ts.isObjectLiteralExpression(expr) && objectHasNoopScrollToFn(expr)) {
        return true;
      }
    }
  }
  return false;
};

const findVirtualizersMissingNoopScrollToFn = (
  fileName: string,
  content: string
): VirtualizerFinding[] => {
  const source = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const findings: VirtualizerFinding[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useVirtualizer'
    ) {
      const firstArg = node.arguments[0];
      if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) {
        findings.push({
          line: lineOf(source, node),
          reason: 'useVirtualizer options must be an object literal with a no-op scrollToFn',
        });
      } else if (!objectHasNoopScrollToFn(firstArg)) {
        findings.push({
          line: lineOf(source, node),
          reason: 'useVirtualizer must wire scrollToFn to NOOP_THREAD_SCROLL_TO_FN (or () => {})',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
};

describe('thread scroll architecture', () => {
  it('prevents scrollTop/scrollTo/scrollBy/scrollToIndex writes outside the owner funnel', () => {
    const files = SCANNED_DIRS.flatMap(collectSourceFiles);
    const violations: string[] = [];
    const observedAllowlisted: Record<string, number> = {};

    for (const rel of files) {
      if (rel === OWNER_FUNNEL_FILE) continue;
      const content = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      const findings = findScrollWritesInSource(rel, content);
      if (findings.length === 0) continue;

      const expectedCount = LEGACY_SCROLL_WRITE_ALLOWLIST[rel];
      if (expectedCount === undefined) {
        violations.push(
          `${rel}: ${findings
            .map((f) => `${f.kind}@L${f.line}`)
            .join(', ')} (must route through ${OWNER_FUNNEL_FILE})`
        );
      } else {
        observedAllowlisted[rel] = findings.length;
        if (findings.length > expectedCount) {
          violations.push(
            `${rel}: found ${findings.length} writes (expected <= ${expectedCount}): ${findings
              .map((f) => `${f.kind}@L${f.line}`)
              .join(', ')}`
          );
        }
      }
    }

    expect(violations).toEqual([]);
    expect(Object.keys(observedAllowlisted).sort()).toEqual(
      Object.keys(LEGACY_SCROLL_WRITE_ALLOWLIST).sort()
    );
  });

  it('requires every timeline useVirtualizer call to wire a no-op scrollToFn', () => {
    const files = SCANNED_DIRS.flatMap(collectSourceFiles);
    const violations: string[] = [];
    let virtualizerCount = 0;

    for (const rel of files) {
      const content = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      if (content.includes('useVirtualizer(') || content.includes('useVirtualizer<')) {
        virtualizerCount += 1;
      }
      for (const finding of findVirtualizersMissingNoopScrollToFn(rel, content)) {
        violations.push(`${rel}:${finding.line}: ${finding.reason}`);
      }
    }

    expect(virtualizerCount).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('self-checks that forbidden scroll writes and omitted scrollToFn are caught', () => {
    const badWrites = findScrollWritesInSource(
      'fakeThread.ts',
      `
      el.scrollTop = 10;
      el.scrollTop += 5;
      el.scrollTo({ top: 0 });
      el.scrollBy({ top: 12 });
      virtualizer.scrollToIndex(3);
      scrollToBottom(el, 'instant');
      `
    );
    expect(badWrites.map((f) => f.kind)).toEqual([
      'scrollTop=',
      'scrollTop=',
      'scrollTo',
      'scrollBy',
      'scrollToIndex',
      'scrollToBottom',
    ]);

    expect(
      findVirtualizersMissingNoopScrollToFn(
        'fakeTimeline.ts',
        `useVirtualizer({ count: 10, getScrollElement, estimateSize });`
      )
    ).toHaveLength(1);
    expect(
      findVirtualizersMissingNoopScrollToFn(
        'fakeTimeline.ts',
        `useVirtualizer({ count: 10, scrollToFn: elementScroll });`
      )
    ).toHaveLength(1);
    expect(
      findVirtualizersMissingNoopScrollToFn(
        'fakeTimeline.ts',
        `useVirtualizer({ count: 10, ...(enabled ? { scrollToFn: NOOP_THREAD_SCROLL_TO_FN } : {}) });`
      )
    ).toEqual([]);
  });
});
