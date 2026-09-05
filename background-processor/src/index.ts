import dotenv from 'dotenv';
import { providerFromEnv } from './utils/email-provider.js';
import { runNotificationDispatcher } from './jobs/notification-dispatcher.js';
import { runDocumentScanner } from './jobs/document-scanner.js';
import { runSchedulerTick, runProjectionCatchUp } from './jobs/scheduler-tick.js';

dotenv.config();

function pollingIntervalMs(): number { return parseInt(process.env.POLLING_INTERVAL_MS || '5000', 10); }

console.log('=================================');
console.log('ATS Background Processor Starting');
console.log('=================================');
console.log(`Build: ${process.env.GIT_COMMIT || 'dev'} (${process.env.BUILD_TIME || 'unknown build time'})`);
console.log(`NextJS API URL: ${process.env.NEXTJS_API_URL}`);
console.log(`Email provider: ${process.env.EMAIL_PROVIDER || 'log'}`);
console.log(`Polling Interval: ${pollingIntervalMs()}ms`);
console.log('=================================');

const provider = providerFromEnv();

async function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

// Each cycle drains the todo lists (event-modelling automation slices):
// projections → schedulers → scans → notifications.
async function runJobLoop(): Promise<void> {
  let cycle = 0;
  while (true) {
    cycle++;
    try {
      await runProjectionCatchUp();
      await runSchedulerTick();
      await runDocumentScanner();
      await runNotificationDispatcher(provider);
      if (cycle % 60 === 0) console.log(`[${new Date().toISOString()}] cycle ${cycle} ok`);
    } catch (error: any) {
      console.error('[Job Loop] Error:', error.message);
    }
    await sleep(pollingIntervalMs());
  }
}

runJobLoop().catch(error => { console.error('[Fatal Error]:', error); process.exit(1); });
