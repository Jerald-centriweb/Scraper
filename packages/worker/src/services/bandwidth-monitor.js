class BandwidthMonitor {
  constructor() {
    this.dailyBudgetGB = parseFloat(process.env.DAILY_GB_BUDGET || '2');
    this.monthlyBudgetGB = parseFloat(process.env.MONTHLY_GB_BUDGET || '30');
    this.usage = {
      daily: 0,
      monthly: 0,
      session: 0
    };
    this.startTime = Date.now();
  }

  setupPageMonitoring(page) {
    if (!page) return;
    
    page.on('response', (response) => {
      try {
        const contentLength = response.headers()['content-length'];
        if (contentLength) {
          const bytes = parseInt(contentLength, 10);
          if (!isNaN(bytes)) {
            this.addUsage(bytes);
          }
        }
      } catch (error) {
        // Ignore monitoring errors
      }
    });
  }

  addUsage(bytes) {
    const gb = bytes / (1024 * 1024 * 1024);
    this.usage.session += gb;
    this.usage.daily += gb;
    this.usage.monthly += gb;
  }

  getUsageStats() {
    const duration = (Date.now() - this.startTime) / 1000;
    return {
      session: {
        gb: Math.round(this.usage.session * 1000) / 1000,
        duration: Math.round(duration)
      },
      daily: {
        gb: Math.round(this.usage.daily * 1000) / 1000,
        budgetGB: this.dailyBudgetGB,
        remaining: Math.max(0, this.dailyBudgetGB - this.usage.daily)
      },
      monthly: {
        gb: Math.round(this.usage.monthly * 1000) / 1000,
        budgetGB: this.monthlyBudgetGB,
        remaining: Math.max(0, this.monthlyBudgetGB - this.usage.monthly)
      }
    };
  }

  isOverBudget() {
    return this.usage.daily > this.dailyBudgetGB || this.usage.monthly > this.monthlyBudgetGB;
  }

  async cleanup() {
    // Reset session usage
    this.usage.session = 0;
  }
}

module.exports = BandwidthMonitor;