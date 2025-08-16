require('dotenv').config();
const { Worker } = require('bullmq');
const { runCrawlJob } = require('./crawler');

const connection = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10)
};
if (process.env.REDIS_PASSWORD) connection.password = process.env.REDIS_PASSWORD;

const queueName = 'estate-scraper';

const worker = new Worker(
  queueName,
  async (job) => {
    const start = Date.now();
    const result = await runCrawlJob(job.data, job.id, (p) => job.updateProgress(Math.round(p)));
    return {
      ...result,
      jobId: job.id,
      durationSecs: Math.round((Date.now() - start) / 1000)
    };
  },
  { connection, concurrency: parseInt(process.env.MAX_CONCURRENT_JOBS || '2', 10) }
);

worker.on('completed', (job) => console.log(`✅ Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`❌ Job ${job?.id} failed: ${err?.message}`));

const shutdown = async () => { try { await worker.close(); } catch {} process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);