import { useMemo, type ReactNode } from 'react';
import type { InteractiveQuestion } from '../../matrix/protocol/interactiveQuestion';
import { splitQuestionBlock } from './questionBlockSplit';

type RenderHtml = (html: string | undefined) => ReactNode;

type QuestionHtmlProps = {
  html: string | undefined;
  question: InteractiveQuestion;
  renderCard: (showText: boolean) => ReactNode;
  renderHtml: RenderHtml;
};

/** A part of the reply's HTML, with the card where the part holds the question's text. */
function QuestionHtml({ html, question, renderCard, renderHtml }: QuestionHtmlProps) {
  const split = useMemo(
    () => (html ? splitQuestionBlock(html, question) : undefined),
    [html, question]
  );
  if (!split) return <>{renderHtml(html)}</>;
  return (
    <>
      {split.before.trim() !== '' && renderHtml(split.before)}
      {renderCard(true)}
      {split.after.trim() !== '' && renderHtml(split.after)}
    </>
  );
}

type QuestionReplyProps = QuestionHtmlProps & {
  /** The reply's body around a renderer of its HTML: its reasoning, its folded work. */
  renderBody: (renderHtml: RenderHtml) => ReactNode;
};

/**
 * An agent reply that asks a question: the card takes the place of the question's text in the
 * reply, or, when the reply does not show that text as MindRoom writes it, adds its buttons under
 * the reply, so nothing the reply says is lost.
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
  const stableQuestion = useMemo(
    () => JSON.parse(questionKey) as InteractiveQuestion,
    [questionKey]
  );
  const found = useMemo(
    () => html !== undefined && splitQuestionBlock(html, stableQuestion) !== undefined,
    [html, stableQuestion]
  );
  if (!found) {
    return (
      <>
        {renderBody(renderHtml)}
        {renderCard(false)}
      </>
    );
  }
  return (
    <>
      {renderBody((part) => (
        <QuestionHtml
          html={part}
          question={stableQuestion}
          renderCard={renderCard}
          renderHtml={renderHtml}
        />
      ))}
    </>
  );
}
