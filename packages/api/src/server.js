require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { Queue } = require('bullmq');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

// Optional: trust proxy when behind LB/reverse proxy
if ((process.env.TRUST_PROXY || '').toLowerCase() === 'true') {
  app.set('trust proxy', 1);
}

// CORS
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));

// Rate limit (only /jobs)
const limiter = rateLimit({
  windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '900000', 10),
  max: parseInt(process.env.API_RATE_LIMIT_MAX || '100', 10),
  standardHeaders: true,
  legacyHeaders: false
});

// Optional token protection for /jobs
const JOB_TOKEN = process.env.JOB_TOKEN;
app.use('/jobs', (req, res, next) => {
  if (!JOB_TOKEN) return next();
  const t = req.get('x-job-token');
  if (t !== JOB_TOKEN) return res.status(401).json({ success: false, error: 'Unauthorized' });
  next();
});
app.use('/jobs', limiter);

// Queue (Redis)
const queueConnection = {
  host: process.env.REDIS_HOST || 'redis',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3
};
if (process.env.REDIS_PASSWORD) queueConnection.password = process.env.REDIS_PASSWORD;

const queue = new Queue('estate-scraper', {
  connection: queueConnection,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 }
  }
});

// PG pool for /health DB check
const pool = new Pool({
  host: process.env.PG_HOST,
  port: parseInt(process.env.PG_PORT || '5432', 10),
  database: process.env.PG_DB,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  connectionTimeoutMillis: 2000,
  ssl:
    process.env.PG_SSL === 'true' || process.env.PG_SSL === 'require'
      ? { rejectUnauthorized: false }
      : false
});

// Validation schema
const JobSchema = z.object({
  client_name: z.string().min(1).max(100),
  area_name: z.string().min(1).max(100),
  country: z.enum(['AU', 'NZ']),
  buy_urls: z.array(z.string().url()).optional().default([]),
  sold_urls: z.array(z.string().url()).optional().default([])
}).refine((d) => d.buy_urls.length > 0 || d.sold_urls.length > 0, {
  message: 'At least one of buy_urls or sold_urls must be provided'
});

// Routes
app.post('/jobs', async (req, res) => {
  try {
    const parsed = JobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.flatten() });
    }
    const jobData = parsed.data;
    const job = await queue.add('scrape-estate', jobData, {
      priority: jobData.country === 'AU' ? 100 : 110
    });
    res.json({
      success: true,
      jobId: job.id,
      status: 'queued',
      country: jobData.country,
      client: jobData.client_name,
      area: jobData.area_name
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create job', message: error.message });
  }
});

app.get('/jobs/:id', async (req, res) => {
  try {
    const job = await queue.getJob(req.params.id);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    const state = await job.getState();
    res.json({
      success: true,
      id: job.id,
      status: state,
      progress: job.progress || 0,
      result: job.returnvalue,
      error: job.failedReason,
      createdAt: job.timestamp,
      processedAt: job.processedOn,
      completedAt: job.finishedOn,
      data: {
        client: job.data.client_name,
        area: job.data.area_name,
        country: job.data.country
      }
    });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to get job status' });
  }
});

// Optional admin protection for introspection endpoints
const requireAdmin = (req, res, next) => {
  const token = process.env.API_ADMIN_TOKEN;
  if (!token) return next(); // open if not set
  const provided = req.header('x-admin-token');
  if (provided === token) return next();
  return res.status(403).json({ success: false, error: 'Forbidden' });
};

app.get('/health', async (_req, res) => {
  try {
    await queue.client.ping();
    let dbStatus = 'not_tested';
    try {
      await pool.query('SELECT 1');
      dbStatus = 'connected';
    } catch {
      dbStatus = 'failed';
    }
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      redis: 'connected',
      database: dbStatus,
      queue: counts
    });
  } catch {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: 'Redis connection failed',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/queue/status', requireAdmin, async (_req, res) => {
  try {
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(0, 10),
      queue.getFailed(0, 10)
    ]);
    res.json({
      success: true,
      queue: {
        waiting: waiting.map((j) => ({ id: j.id, client: j.data.client_name, area: j.data.area_name })),
        active: active.map((j) => ({ id: j.id, client: j.data.client_name, area: j.data.area_name, progress: j.progress })),
        recentCompleted: completed.map((j) => ({ id: j.id, client: j.data.client_name, area: j.data.area_name })),
        recentFailed: failed.map((j) => ({ id: j.id, client: j.data.client_name, area: j.data.area_name, error: j.failedReason }))
      }
    });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to get queue status' });
  }
});

// 404 and error
app.use((req, res) => res.status(404).json({ success: false, error: 'Not found', message: `Route ${req.method} ${req.path} not found` }));
app.use((err, _req, res, _next) => res.status(500).json({ success: false, error: 'Internal server error', message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong' }));

// Start + graceful shutdown
const PORT = Number(process.env.PORT || process.env.API_PORT || 3000);
const server = app.listen(PORT, () => { console.log(`🏡 Estate Scraper API running on port ${PORT}`); });
const shutdown = async () => { try { await queue.close(); await pool.end(); } catch {} server.close(() => process.exit(0)); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);