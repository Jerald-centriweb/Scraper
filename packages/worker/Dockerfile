FROM ghcr.io/puppeteer/puppeteer:21.6.0

RUN apt-get update && apt-get install -y \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# Speed up install: base image already includes Chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install --omit=dev

COPY . .

# Use non-root (base image defaults to pptruser)
USER pptruser

ENV NODE_OPTIONS="--max-old-space-size=2048"

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "console.log('Worker health check OK')" || exit 1

CMD ["npm", "start"]