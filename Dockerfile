FROM node:20-slim AS base

# Install dependencies for Playwright and better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    # Playwright browser dependencies
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libxshmfence1 \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# Install Playwright Chromium browser
RUN npx playwright install chromium

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /root/.cache /root/.cache
COPY . .

# Create data directory for SQLite
RUN mkdir -p data browser-data

# Build Next.js
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy Playwright browsers from deps stage
COPY --from=deps /root/.cache /root/.cache

# Copy built app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/src/db ./src/db
COPY --from=builder /app/scripts ./scripts

# Create persistent directories
RUN mkdir -p data browser-data

EXPOSE 3000

CMD ["node", "server.js"]
