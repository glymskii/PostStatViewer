import cron, { type ScheduledTask } from "node-cron";
import { runScrapeForAllAccounts } from "./common/runner";

let currentTask: ScheduledTask | null = null;

export function startScheduler(cronExpression: string) {
  stopScheduler();

  if (!cron.validate(cronExpression)) {
    console.error(`[scheduler] Invalid cron expression: ${cronExpression}`);
    return;
  }

  console.log(`[scheduler] Starting with schedule: ${cronExpression}`);
  currentTask = cron.schedule(cronExpression, async () => {
    console.log(`[scheduler] Triggered at ${new Date().toISOString()}`);
    // Add jitter: random delay 0-5 minutes
    const jitterMs = Math.floor(Math.random() * 5 * 60 * 1000);
    await new Promise((resolve) => setTimeout(resolve, jitterMs));
    await runScrapeForAllAccounts();
  });
}

export function stopScheduler() {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
    console.log("[scheduler] Stopped");
  }
}

export function isSchedulerRunning(): boolean {
  return currentTask !== null;
}
