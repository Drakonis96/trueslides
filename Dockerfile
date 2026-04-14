FROM node:20-alpine AS base

# ── Dependencies ──
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# ── Build ──
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Production ──
FROM base AS runner
WORKDIR /app

# LibreOffice + poppler for PPTX-to-images conversion, plus fonts
RUN apk add --no-cache libreoffice-impress poppler-utils ttf-dejavu font-noto

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Ensure data directory exists and is writable
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
