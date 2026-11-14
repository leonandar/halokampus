# One image for api, worker, mock-pmb and web (each compose service picks its command).
# Full Debian image: it already ships OpenSSL for Prisma, so no apt step (works behind
# restrictive proxies too).
FROM node:22-bookworm
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @hk/db generate \
 && pnpm --filter @hk/widget build \
 && API_INTERNAL_URL=http://api:4000 pnpm --filter @hk/web build
ENV NODE_ENV=production CONFIG_DIR=/app/config
