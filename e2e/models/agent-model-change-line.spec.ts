import type { Page } from '@playwright/test';
import {
  bodyOf,
  expect,
  inThread,
  lobbyEvents,
  messageRow,
  openLobby,
  openThread,
  sendFromComposer,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
  type AgentStack,
  type MatrixEvent,
} from '../helpers/agentStack';

// A thread's model change with a live MindRoom backend: the router answers the command with
// `io.mindroom.model_selection_result`, and the open thread shows the two messages as one line
// (src/app/messages/modelChanges.ts). A backend before typed results answers a typed command
// without one, so there only the picker's change becomes a line.
test.describe.configure({ timeout: 300_000 });

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

// AGENT_UI_SHOTS=<directory> also saves screenshots of the result.
const shot = async (page: Page, name: string) => {
  if (process.env.AGENT_UI_SHOTS)
    await page.screenshot({ path: `${process.env.AGENT_UI_SHOTS}/${name}.png` });
};

const named = (name: string): RegExp =>
  new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
const UNCHOSEN = /^(Agent default|Default)/;

type Result = { command_event_id?: string; operation?: string; status?: string; model?: string };
const resultOf = (event: MatrixEvent): Result | undefined =>
  event.content['io.mindroom.model_selection_result'] as Result | undefined;

/** The thread's command with this body and the router's reply to it, as the homeserver has them. */
const commandAndReply = async (
  stack: AgentStack,
  rootId: string,
  body: string
): Promise<{ command: MatrixEvent; reply: MatrixEvent }> => {
  let found: { command: MatrixEvent; reply: MatrixEvent } | undefined;
  await expect
    .poll(
      async () => {
        const events = (await lobbyEvents(stack)).filter((event) => inThread(event, rootId));
        const at = events.findIndex(
          (event) => event.sender === stack.tester.userId && bodyOf(event) === body
        );
        const command = events[at];
        const reply = events
          .slice(at + 1)
          .find((event) => event.sender === stack.agents.router && event.type === 'm.room.message');
        if (command && reply) found = { command, reply };
        return !!found;
      },
      { timeout: 90_000, intervals: [500, 1000], message: `the router's reply to ${body}` }
    )
    .toBe(true);
  return found as { command: MatrixEvent; reply: MatrixEvent };
};

const lines = (page: Page) => page.locator('[data-model-change]');

test('an applied thread model change shows as one line, and a refused one stays two messages', async ({
  page,
  stack,
}) => {
  const { first, second } = stack.models;
  await page.setViewportSize(DESKTOP);
  await openLobby(page, stack);
  const word = uniqueWord('modelline');
  const rootId = await startThread(stack, `${word} first question`);
  await showThread(page, stack, rootId);
  await waitForAgentReply(stack, rootId, (body) => body.includes('first question'), {
    modelId: first.id,
  });

  // The picker's change: one line at the router's reply, which names the model the viewer's own
  // picker lists, and no row for the command.
  const chip = page.getByRole('button', { name: 'Choose model' });
  await expect(chip).toHaveText(UNCHOSEN, { timeout: 60_000 });
  await chip.click();
  const option = page
    .getByRole('listbox', { name: 'Models' })
    .getByRole('option', { name: named(second.displayName) });
  await expect(option).toBeVisible({ timeout: 60_000 });
  await option.click();
  await expect(chip).toHaveText(second.displayName, { timeout: 60_000 });
  const set = await commandAndReply(stack, rootId, `!model ${second.key}`);
  expect(resultOf(set.reply)).toMatchObject({
    command_event_id: set.command.event_id,
    operation: 'set',
    status: 'applied',
    model: second.key,
  });
  const setRow = messageRow(page, set.reply.event_id);
  // The row's whole text: the router's own words are not drawn.
  await expect(setRow).toHaveText(`Model set${second.displayName}`, { timeout: 60_000 });
  await expect(setRow.locator('[data-model-change="set"]')).toBeVisible();
  await expect(page.locator(`[data-message-id="${set.command.event_id}"]`)).toHaveCount(0);

  // A typed reset: a line that names no model.
  await sendFromComposer(page, '!model reset');
  const reset = await commandAndReply(stack, rootId, '!model reset');
  await expect(chip).toHaveText(UNCHOSEN, { timeout: 60_000 });
  const resetRow = messageRow(page, reset.reply.event_id);
  const typedResults = resultOf(reset.reply) !== undefined;
  if (typedResults) {
    await expect(resetRow).toHaveText('Model resetBack to inherited models', { timeout: 60_000 });
    await expect(page.locator(`[data-message-id="${reset.command.event_id}"]`)).toHaveCount(0);
  } else {
    // A backend before typed results: the command and the reply stay messages.
    await expect(messageRow(page, reset.command.event_id)).toContainText('!model reset');
    await expect(resetRow).toBeVisible();
    await expect(resetRow.locator('[data-model-change]')).toHaveCount(0);
  }

  // A model nobody has: the router refuses, and both messages stay as they are.
  const missing = `${word}-missing`;
  await sendFromComposer(page, `!model ${missing}`);
  const refused = await commandAndReply(stack, rootId, `!model ${missing}`);
  await expect(messageRow(page, refused.command.event_id)).toContainText(`!model ${missing}`);
  await expect(messageRow(page, refused.reply.event_id)).toContainText('Unknown model');
  await expect(messageRow(page, refused.reply.event_id).locator('[data-model-change]')).toHaveCount(
    0
  );
  await expect(lines(page)).toHaveCount(typedResults ? 2 : 1);
  await shot(page, 'model-change-desktop');

  // The line opens who changed it, when, and what the change covers.
  const trigger = setRow.getByRole('button');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const details = setRow.locator('[data-model-change-details]');
  await expect(details).toContainText('Changed by');
  await expect(details).toContainText(
    'Applies to future replies in this thread from the agents and teams you may address.'
  );
  await shot(page, 'model-change-desktop-expanded');

  // A phone's width keeps the line and its details inside the thread.
  await page.setViewportSize(PHONE);
  await setRow.scrollIntoViewIfNeeded();
  await expect(details).toBeVisible();
  const fits = await setRow.evaluate((row) => {
    const box = row.getBoundingClientRect();
    return box.left >= 0 && box.right <= window.innerWidth;
  });
  expect(fits).toBe(true);
  await shot(page, 'model-change-phone-expanded');
  await trigger.click();
  await expect(details).toHaveCount(0);
  await shot(page, 'model-change-phone');

  // After a reload the lines are read from the thread again, and the set's line names the model
  // once the picker has discovered the thread's catalog (MODEL_TIMEOUT, 12 s), its key until then.
  await page.setViewportSize(DESKTOP);
  await openThread(page, stack, rootId);
  await expect(messageRow(page, set.reply.event_id)).toHaveText(`Model set${second.displayName}`, {
    timeout: 60_000,
  });
  await expect(page.locator(`[data-message-id="${set.command.event_id}"]`)).toHaveCount(0);
  await expect(messageRow(page, refused.command.event_id)).toContainText(`!model ${missing}`);
  await expect(lines(page)).toHaveCount(typedResults ? 2 : 1);
});
