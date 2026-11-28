import type { ChildNode } from 'domhandler';
import type { HTMLReactParserOptions } from 'html-react-parser';
import type { AiRunErrorInfo } from '../../matrix/protocol/aiRun';
import type { InteractiveQuestion } from '../../matrix/protocol/interactiveQuestion';
import { cloneDomNodes, isBlank } from './replyDomNodes';
import { collapseRestartMarkersDom, stripTrailingRunErrorDom } from './runErrorHtml';
import { placeQuestionCardInDom } from '../question/questionBlockSplit';
import { splitFinishedWorkDom, type FinishedWorkDomSplit } from './finishedWorkSplit';

export * from './replyDomNodes';

export type PreparedAgentReplyDom = {
  nodes: ChildNode[];
  bodyEmpty: boolean;
  hasSlots: boolean;
  questionPlaced: boolean;
  toolCallIndexes?: number[];
  split?: FinishedWorkDomSplit;
};

/** Runs all DOM-level reply transforms without mutating `canonicalDom`. */
export const prepareAgentReplyDom = (args: {
  canonicalDom: readonly ChildNode[];
  runErrorEnabled: boolean;
  runError?: AiRunErrorInfo;
  question?: InteractiveQuestion;
  shouldFold: boolean;
  baseOpts: HTMLReactParserOptions;
}): PreparedAgentReplyDom => {
  let nodes: readonly ChildNode[] = args.canonicalDom;
  let hasSlots = false;

  if (args.runErrorEnabled) {
    if (args.runError) {
      const stripped = stripTrailingRunErrorDom(nodes, args.runError);
      nodes = stripped.nodes;
      if (stripped.stripped && nodes.every(isBlank)) {
        return { nodes: [], bodyEmpty: true, hasSlots: false, questionPlaced: false };
      }
    }
    const collapsed = collapseRestartMarkersDom(nodes);
    nodes = collapsed.nodes;
    hasSlots = collapsed.hasRestartSeam;
  }

  const placed = args.question ? placeQuestionCardInDom(nodes, args.question) : undefined;
  const questionPlaced = placed !== undefined;
  if (placed) {
    nodes = placed;
    hasSlots = true;
  }

  const fold = args.shouldFold ? splitFinishedWorkDom(nodes, args.baseOpts) : undefined;
  return {
    nodes: cloneDomNodes(nodes),
    bodyEmpty: false,
    hasSlots,
    questionPlaced,
    toolCallIndexes: fold?.toolCallIndexes,
    split: fold?.split,
  };
};
