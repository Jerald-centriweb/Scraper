# Scraper
# Estate Scraper – Full A→Z Production Setup (Hostinger-Ready)
This is a complete, hardened, and step-by-step setup to run the Estate Scraper on a Hostinger VPS. It’s written for a junior developer to execute without prior context.

What you get
- API service (Express) with:
  - Input validation (Zod), rate limiting, CORS
  - Protected job submission (x-job-token)
  - Optional admin protection for queue introspection (/queue/status via x-admin-token)
  - Health endpoint with job counts
  - Graceful shutdown (closes Redis queue + PostgreSQL pool)

- Worker service (Crawlee + Puppeteer stealth) with:
  - Proxy support + reliable proxy authentication
  - Bandwidth-friendly request blocking (fonts/media/stylesheets)
  - Graceful shutdown
  - Database persistence for listings and snapshots

- Infra:
  - Docker Compose (API + Worker + Redis)
  - Redis password protection
  - Restart policies for resilience

- DB schema + migration script:
  - listings, snapshots, expired_listings view

- n8n workflow:
  - Corrected wiring, token header added, robust polling loop

- Scripts:
  - hostinger-setup.sh (installs Docker, Compose, jq, psql)
  - migrate-db.sh (runs schema)
  - test-system.sh (submits a test job and polls)

Important note about scraping adapters
- The worker includes stub adapters for realestate.com.au and realestate.co.nz. They’re safe and won’t crash, but they won’t parse real listings.
- If your repo already has real adapters, replace the files under packages/worker/src/adapters/ with your actual implementation. Everything else stays the same.

A→Z Quick Start

0) Clone and branch (local machine or VPS)
- git clone <your-repo-url>
- cd Scraper
- git checkout -b feature/production-hardened

1) VPS one-time setup
- ssh into your Hostinger VPS
- ./scripts/hostinger-setup.sh
- Log out and back in (or run: newgrp docker) so you can use Docker without sudo.

2) Configure environment
- cp infra/.env.example infra/.env
- Open infra/.env and fill values:
  - PG_*: your Postgres (Supabase recommended)
  - REDIS_PASSWORD: strong password
  - PROXY_*: residential proxies for AU/NZ (http://user:pass@host:port)
  - CORS_ORIGINS: domains allowed to call API (e.g., your n8n/admin)
  - JOB_TOKEN: required header x-job-token to submit jobs in prod
  - API_ADMIN_TOKEN: optional header x-admin-token to access /queue/status
  - TRUST_PROXY: true if behind a reverse proxy/LB (Hostinger often is)
  - PUBLIC_API_URL: public URL for API (used by n8n)
  - HOST_API_PORT: host port to expose API (default 3000)

3) Migrate database
- If psql is installed (hostinger-setup.sh does this):
  - ./scripts/migrate-db.sh
- Or use Supabase SQL editor to run db/migrations/001_complete_schema.sql manually.

4) Build and run services
- cd infra
- docker-compose build --no-cache
- docker-compose up -d

5) Health check
- curl http://localhost:${HOST_API_PORT:-3000}/health
- Expected: JSON with { success: true, queue: { waiting, active, completed, ... } }

6) Submit and verify a test job
- cd ..
- ./scripts/test-system.sh
  - Requires JOB_TOKEN in infra/.env
  - Posts a job, polls until completed/failed

7) n8n workflow (optional but recommended)
- Open n8n (your instance)
- Import docs/n8n-workflow-fixed.json
- Set n8n environment variables:
  - PUBLIC_API_URL (point to your API)
  - JOB_TOKEN (same as infra/.env)
  - Google Service Account for Sheets (n8n credential)
  - Slack webhook for alerts
- Update Google Sheet IDs in the workflow nodes
- Test: run once manually and confirm sheet statuses transition: ready → processing → completed.

Operations

- Logs:
  - docker logs -f estate-api
  - docker logs -f estate-worker

- Restart:
  - cd infra && docker-compose down && docker-compose up -d --build

- Security:
  - /jobs requires x-job-token if JOB_TOKEN is set
  - /queue/status requires x-admin-token if API_ADMIN_TOKEN is set
  - Set TRUST_PROXY=true if behind a reverse proxy

- Ports:
  - API always listens on container port 3000
  - Host port configurable via HOST_API_PORT in infra/.env

Troubleshooting

- Health 500 or Redis errors: check REDIS_PASSWORD in infra/.env; ensure services healthy:
  - docker ps
  - docker logs estate-redis
- 401 on /jobs: ensure x-job-token header in requests matches JOB_TOKEN
- 403 /queue/status: set API_ADMIN_TOKEN and send x-admin-token header
- CORS blocked: add your domain(s) to CORS_ORIGINS and restart
- Chromium crashes: ensure VPS RAM is sufficient; Compose sets shm_size: 1gb; upgrade VPS if needed
- DB SSL errors (Supabase): PG_SSL=true uses sslmode=require with non-strict cert, already configured

Hand-off checklist (for your dev)
- [ ] Run ./scripts/hostinger-setup.sh
- [ ] cp infra/.env.example infra/.env and fill values
- [ ] ./scripts/migrate-db.sh (or run SQL in Supabase UI)
- [ ] cd infra && docker-compose build --no-cache && docker-compose up -d
- [ ] curl http://localhost:${HOST_API_PORT}/health
- [ ] ./scripts/test-system.sh
- [ ] Import docs/n8n-workflow-fixed.json (optional)
- [ ] Confirm end-to-end success
