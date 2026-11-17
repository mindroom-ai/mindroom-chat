import { useMemo, type ReactNode } from 'react';
import type { InteractiveQuestion } from '../../matrix/protocol/interactiveQuestion';
import { QUESTION_CARD_PLACE, splitQuestionBlock } from './questionBlockSplit';

type RenderHtml = (html: string | undefined) => ReactNode;

type QuestionReplyProps = {
  html: string | undefined;
  question: InteractiveQuestion;
  renderCard: (showText: boolean) => ReactNode;
  renderHtml: RenderHtml;
  /** The reply's body from its HTML and a renderer of that HTML: its reasoning, its folded work. */
  renderBody: (renderHtml: RenderHtml, html: string | undefined) => ReactNode;
};

/**
 * An agent reply that asks a question: the card takes the place of the question's text in the
 * reply, or, when the reply does not show that text as MindRoom writes it (or has no HTML), adds
 * its buttons under the reply, so nothing the reply says is lost.
 */
export function QuestionReply({
  html,
  question,
  renderCard,
  renderHtml,
  renderBody,
}: QuestionReplyProps) {
  // Each render reads the question again; its value, not its identity, decides the split.
  const questionKey = JSON.stringify(question);
  const marked = useMemo(() => {
    if (!html) return undefined;
    // A body-only reply's HTML comes with the place marked (`formatQuestionBody`).
    if (html.includes(QUESTION_CARD_PLACE)) return html;
    const split = splitQuestionBlock(html, JSON.parse(questionKey) as InteractiveQuestion);
    return split && `${split.before}${QUESTION_CARD_PLACE}${split.after}`;
  }, [html, questionKey]);
  if (marked === undefined) {
    return (
      <>
        {renderBody(renderHtml, html)}
        {renderCard(false)}
      </>
    );
  }
  const renderPart: RenderHtml = (part) => {
    const at = part?.indexOf(QUESTION_CARD_PLACE) ?? -1;
    if (!part || at < 0) return renderHtml(part);
    const before = part.slice(0, at);
    const after = part.slice(at + QUESTION_CARD_PLACE.length);
    return (
      <>
        {before.trim() !== '' && renderHtml(before)}
        {renderCard(true)}
        {after.trim() !== '' && renderHtml(after)}
      </>
    );
  };
  return <>{renderBody(renderPart, marked)}</>;
}
