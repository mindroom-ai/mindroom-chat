import type { Page } from '@playwright/test';
import {
  expect,
  messageRow,
  openLobby,
  openThread,
  sendFromComposer,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
} from '../helpers/agentStack';

// The model badge and the thread model picker with a live MindRoom backend: the picker asks the
// router for its catalog over encrypted to-device messages, sends `!model <key>`, and the next reply
// runs on that model (the backend names it in the reply's `io.mindroom.ai_run` metadata).
test.describe.configure({ timeout: 300_000 });

// AGENT_UI_SHOTS=<directory> also saves screenshots of the result.
const shot = async (page: Page, name: string) => {
  if (process.env.AGENT_UI_SHOTS)
    await page.screenshot({ path: `${process.env.AGENT_UI_SHOTS}/${name}.png` });
};

// A model's own row starts with its name; "Room default" names the models the agents fall back to.
const named = (name: string): RegExp =>
  new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

test('a thread switches to another model from the picker, and the choice survives a reload', async ({
  page,
  stack,
}) => {
  const { first, second } = stack.models;
  await openLobby(page, stack);
  const word = uniqueWord('model');
  const rootId = await startThread(stack, `${word} first question`);
  await showThread(page, stack, rootId);

  const firstReply = await waitForAgentReply(
    stack,
    rootId,
    (body) => body.includes('first question'),
    {
      modelId: first.id,
    }
  );
  const firstRow = messageRow(page, firstReply.event_id);
  await expect(firstRow).toContainText(`You said: ${word} first question`);
  // The badge under the agent's avatar names the model that answered.
  await expect(firstRow).toContainText(first.displayName);

  const chip = page.getByRole('button', { name: 'Choose model' });
  await expect(chip).toHaveText('Room default', { timeout: 60_000 });
  await chip.click();
  const models = page.getByRole('listbox', { name: 'Models' });
  await expect(models.getByRole('option', { name: named(second.displayName) })).toBeVisible({
    timeout: 60_000,
  });
  await expect(models.getByRole('option', { name: named(first.displayName) })).toBeVisible();
  await models.getByRole('option', { name: named(second.displayName) }).click();
  await expect(chip).toHaveText(second.displayName, { timeout: 60_000 });
  // The router confirms the switch in the thread.
  await expect(page.getByText(`This thread now uses ${second.key}`)).toBeVisible({
    timeout: 60_000,
  });

  await sendFromComposer(page, 'second question');
  const secondReply = await waitForAgentReply(
    stack,
    rootId,
    (body) => body.includes('second question'),
    {
      modelId: second.id,
    }
  );
  const secondRow = messageRow(page, secondReply.event_id);
  await expect(secondRow).toContainText('You said: second question', { timeout: 30_000 });
  await expect(secondRow).toContainText(second.displayName);

  // After a reload the chip learns the thread's model from the router again. The picker collects
  // answers for its whole discovery window (MODEL_TIMEOUT, 12 s) before it shows one.
  await openThread(page, stack, rootId);
  await expect(chip).toHaveText(second.displayName, { timeout: 45_000 });
});

test(
  'a typed !model command moves the thread model chip without a reload',
  { tag: '@webkit' },
  async ({ page, stack }) => {
    const { first, second } = stack.models;
    await openLobby(page, stack);
    const word = uniqueWord('typedmodel');
    const rootId = await startThread(stack, `${word} first question`);
    await showThread(page, stack, rootId);
    await waitForAgentReply(stack, rootId, (body) => body.includes('first question'), {
      modelId: first.id,
    });
    const chip = page.getByRole('button', { name: 'Choose model' });
    await expect(chip).toHaveText('Room default', { timeout: 60_000 });

    await sendFromComposer(page, `!model ${second.key}`);
    await expect(page.getByText(`This thread now uses ${second.key}`)).toBeVisible({
      timeout: 60_000,
    });
    // The chip follows the router's answer well inside the picker's 12 s discovery window.
    await expect(chip).toHaveText(second.displayName, { timeout: 10_000 });
    await shot(page, `typed-model-chip-${test.info().project.name}`);

    await sendFromComposer(page, '!model reset');
    await expect(page.getByText('Thread model override removed').last()).toBeVisible({
      timeout: 60_000,
    });
    await expect(chip).toHaveText('Room default', { timeout: 10_000 });
  }
);

test(
  'a !model typed while the thread model discovery runs reaches the chip',
  { tag: '@webkit' },
  async ({ page, stack }) => {
    const { first, second } = stack.models;
    const word = uniqueWord('earlymodel');
    const rootId = await startThread(stack, `${word} first question`);
    await waitForAgentReply(stack, rootId, (body) => body.includes('first question'), {
      modelId: first.id,
    });
    // A fresh load of the finished thread, then the command inside the chip's 12 s discovery
    // window, once the router has answered the discovery (the live test typed 1.5 s after opening;
    // a busy runner can take a few seconds to answer). The live test saw the chip appear 12 s after
    // the thread opened, as "Room default", although the router had already confirmed the switch.
    await openThread(page, stack, rootId);
    await page.waitForTimeout(5_000);
    const chip = page.getByRole('button', { name: 'Choose model' });
    const chipWhenTyped = (await chip.isVisible()) ? await chip.innerText() : 'none';
    await sendFromComposer(page, `!model ${second.key}`);
    await expect(page.getByText(`This thread now uses ${second.key}`)).toBeVisible({
      timeout: 60_000,
    });
    await expect(chip, `the chip read "${chipWhenTyped}" when the command was typed`).toHaveText(
      second.displayName,
      { timeout: 10_000 }
    );
    await shot(page, `early-model-chip-${test.info().project.name}`);
    // The answer from before the command does not come back when the discovery window ends.
    await page.waitForTimeout(13_000);
    await expect(chip).toHaveText(second.displayName);
  }
);
