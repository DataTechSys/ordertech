# Multi-stage Dockerfile for OrderTech Express API
FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Stage 1: Install dependencies
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Stage 2: Copy application code (minimized by .dockerignore)
FROM base AS app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Stage 3: Final runtime image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Copy everything from app stage (already minimized by .dockerignore)
# This is more reliable than selective copying
COPY --from=app --chown=nodejs:nodejs /app ./

# Switch to non-root user
USER nodejs

EXPOSE 8080

# Use npm start for flexibility (can be overridden if needed)
CMD ["npm", "start"]
