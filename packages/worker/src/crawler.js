require('dotenv').config();
const { PuppeteerCrawler } = require('crawlee');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const BandwidthMonitor = require('./services/bandwidth-monitor');
const DatabaseService = require('./services/database');
const RealEstateAUAdapter = require('./adapters/realestate-au');
const RealEstateNZAdapter = require('./adapters/realestate-nz');

puppeteer.use(StealthPlugin());

class EstateCrawler {
  constructor() {
    this.bandwidthMonitor = new BandwidthMonitor();
    this.database = new DatabaseService();
    this.stats = { listingsProcessed: 0, listPagesProcessed: 0, detailPagesProcessed: 0, errors: 0, startTime: Date.now() };
  }

  async runCrawlJob(jobData, jobId, progressCallback) {
    const { buy_urls = [], sold_urls = [] } = jobData;
    const dbConnected = await this.database.testConnection();
    if (!dbConnected) throw new Error('Database connection failed');

    try {
      let progress = 10; await progressCallback?.(progress);
      for (let i = 0; i < buy_urls.length; i++) {
        const u = buy_urls[i]?.trim(); if (!u) continue;
        await this.scrapeUrl(u, 'buy', jobData);
        progress = 10 + ((i + 1) * 35) / Math.max(buy_urls.length, 1);
        await progressCallback?.(Math.round(progress));
        await this.delay(3000, 5000);
      }
      for (let i = 0; i < sold_urls.length; i++) {
        const u = sold_urls[i]?.trim(); if (!u) continue;
        await this.scrapeUrl(u, 'sold', jobData);
        progress = 45 + ((i + 1) * 35) / Math.max(sold_urls.length, 1);
        await progressCallback?.(Math.round(progress));
        await this.delay(3000, 5000);
      }
      await progressCallback?.(95);
      const duration = (Date.now() - this.stats.startTime) / 1000;
      const bandwidthStats = this.bandwidthMonitor.getUsageStats();
      await progressCallback?.(100);
      return { success: true, ...this.stats, bandwidthStats, duration };
    } finally {
      await this.cleanup();
    }
  }

  async scrapeUrl(url, listingType, jobData) {
    const adapter = this.getAdapter(url);
    const proxyForCountry = (country) =>
      country === 'NZ'
        ? (process.env.PROXY_NZ_RESIDENTIAL || process.env.PROXY_AU_RESIDENTIAL)
        : process.env.PROXY_AU_RESIDENTIAL;
    const proxy = proxyForCountry(jobData.country);

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--disable-default-apps',
      '--disable-extensions',
      '--window-size=1920,1080'
    ];
    if (proxy) args.push(`--proxy-server=${proxy}`);

    const crawler = new PuppeteerCrawler({
      launchContext: { launcher: puppeteer, launchOptions: { headless: process.env.HEADLESS !== 'false', args } },
      useIncognitoPages: true,
      maxConcurrency: 1,
      requestHandlerTimeoutSecs: 120,
      maxRequestRetries: 3,
      preNavigationHooks: [
        async ({ page }) => {
          this.bandwidthMonitor.setupPageMonitoring(page);
          // Authenticate to proxy if credentials included
          try {
            const p = proxy || '';
            if (p) {
              const u = new URL(p);
              if (u.username || u.password) await page.authenticate({ username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) });
            }
          } catch {}
          await page.setRequestInterception(true);
          page.on('request', (req) => {
            const type = req.resourceType(); const u = req.url();
            if (type === 'font' || type === 'media') return req.abort();
            if (type === 'stylesheet' && !/critical|property|listing/i.test(u)) return req.abort();
            if (type === 'image' && !/property|listing|cdn|images|photos/i.test(u)) return req.abort();
            return req.continue();
          });
        }
      ],
      requestHandler: async ({ request, page, enqueueLinks, log }) => {
        try {
          const { userData } = request;
          if (userData.type === 'LIST') {
            await this.handleListPage(page, request, enqueueLinks, log, adapter, userData, listingType);
            this.stats.listPagesProcessed++;
          } else if (userData.type === 'DETAIL') {
            const ok = await this.handleDetailPage(page, request, log, adapter, jobData, listingType);
            if (ok) this.stats.listingsProcessed++;
            this.stats.detailPagesProcessed++;
            if (this.stats.listingsProcessed % 10 === 0) log.info(`Progress: ${this.stats.listingsProcessed} listings processed`);
          }
        } catch (err) { this.stats.errors++; throw err; }
        await this.delay(1000, 3000);
      }
    });

    await crawler.addRequests([{ url, userData: { type: 'LIST', listingType, jobData } }]);
    await crawler.run();
  }

  async handleListPage(page, request, enqueueLinks, log, adapter, userData, listingType) {
    await page.waitForSelector('body', { timeout: 30000 });
    const detailLinks = await adapter.getDetailLinks(page);
    if (detailLinks.length > 0) {
      await enqueueLinks({ urls: detailLinks.map(url => ({ url, userData: { type: 'DETAIL', listingType, jobData: userData.jobData } })) });
    }
    const nextPageUrl = await adapter.getNextPageUrl(page);
    if (nextPageUrl && nextPageUrl !== request.url) {
      await enqueueLinks({ urls: [{ url: nextPageUrl, userData: { type: 'LIST', listingType, jobData: userData.jobData } }] });
    }
  }

  async handleDetailPage(page, request, log, adapter, jobData, listingType) {
    await page.waitForSelector('body', { timeout: 30000 });
    const listingData = await adapter.extractListing(page, listingType);
    if (listingData && listingData.success && listingData.external_id) {
      await this.database.saveListing(listingData, jobData);
      return true;
    }
    return false;
  }

  getAdapter(url) {
    if (url.includes('realestate.com.au')) return new RealEstateAUAdapter();
    if (url.includes('realestate.co.nz')) return new RealEstateNZAdapter();
    return new RealEstateAUAdapter();
  }
  async delay(min = 1000, max = 3000) { const d = Math.random() * (max - min) + min; await new Promise(r => setTimeout(r, d)); }
  async cleanup() { try { await this.bandwidthMonitor.cleanup(); } catch (e) {} }
}

async function runCrawlJob(jobData, jobId, progressCallback) {
  const crawler = new EstateCrawler();
  return await crawler.runCrawlJob(jobData, jobId, progressCallback);
}
module.exports = { runCrawlJob };