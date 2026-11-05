import { matrixFetch } from '../helpers/matrix';
import {
  expect,
  openLobby,
  showThread,
  startThread,
  test,
  uniqueWord,
  type AgentStack,
} from '../helpers/agentStack';

// A tool call that runs as a background job with a live MindRoom backend: the thread's jobs bar
// shows it while it runs, and its Stop button cancels it through `io.mindroom.background_job_cancel`.
test.describe.configure({ timeout: 300_000 });

type Job = { job_id: string; thread_id?: string; status: string; tool?: string };

const threadJobs = async (stack: AgentStack, rootId: string): Promise<Job[]> => {
  const state = await matrixFetch<{ type: string; content: { jobs?: Job[] } }[]>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(stack.rooms.lobby)}/state`,
    { accessToken: stack.tester.accessToken }
  );
  return state
    .filter((event) => event.type === 'io.mindroom.background_jobs')
    .flatMap((event) => event.content.jobs ?? [])
    .filter((job) => job.thread_id === rootId);
};

test('a running background job shows in the jobs bar until its Stop button cancels it', async ({
  page,
  stack,
}) => {
  await openLobby(page, stack);
  // The stub's shell call sleeps 45 s and goes to the background at once.
  const rootId = await startThread(stack, `${uniqueWord('job')} #job`);
  await showThread(page, stack, rootId);

  const bar = page.getByRole('region', { name: 'Running: run_shell_command' });
  await expect(bar).toBeVisible({ timeout: 120_000 });
  await expect
    .poll(async () => (await threadJobs(stack, rootId)).map((job) => job.status))
    .toContain('running');

  await bar.getByRole('button', { name: 'Stop run_shell_command' }).click();
  await expect(bar).toBeHidden({ timeout: 60_000 });
  // The backend drops the job from the thread's running jobs.
  await expect
    .poll(async () => (await threadJobs(stack, rootId)).filter((job) => job.status === 'running'), {
      timeout: 60_000,
    })
    .toEqual([]);
});
