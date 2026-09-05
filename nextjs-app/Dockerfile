# Stage 1: Builder
FROM node:22 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . ./
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV GIT_COMMIT=$GIT_COMMIT
ENV BUILD_TIME=$BUILD_TIME
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 2: Production Runtime
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.* ./
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/public ./public
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
ENV GIT_COMMIT=$GIT_COMMIT
ENV BUILD_TIME=$BUILD_TIME
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
# Apply migrations (event store, projections, platform operator), then serve
CMD ["sh", "-c", "node scripts/migrate.js && npm start"]
