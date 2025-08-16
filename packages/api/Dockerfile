FROM node:20-alpine

# Ensure curl for healthcheck
RUN apk update && apk upgrade && apk add --no-cache curl

WORKDIR /app

COPY package*.json ./
# Lockfile-agnostic install
RUN npm install --omit=dev

COPY . .

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["npm", "start"]