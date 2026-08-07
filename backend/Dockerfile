FROM node:25-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@11.7.0
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY schloss-ui/package.json ./schloss-ui/
COPY schloss-server-kit/package.json ./schloss-server-kit/
RUN apk add --no-cache python3 make g++
RUN pnpm install --frozen-lockfile --filter backend --filter @zudar107/schloss-server-kit
COPY schloss-server-kit ./schloss-server-kit
RUN pnpm --filter @zudar107/schloss-server-kit build
COPY backend ./backend
RUN pnpm --filter backend build

FROM node:25-alpine AS runner
WORKDIR /app
RUN npm install -g pnpm@11.7.0 && apk add --no-cache python3 make g++ wget
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
COPY schloss-ui/package.json ./schloss-ui/
COPY schloss-server-kit/package.json ./schloss-server-kit/
RUN pnpm install --prod --frozen-lockfile --filter backend --filter @zudar107/schloss-server-kit
COPY --from=builder /app/schloss-server-kit/dist ./schloss-server-kit/dist
COPY --from=builder /app/schloss-server-kit/node_modules ./schloss-server-kit/node_modules
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/src/db/migrations ./backend/dist/db/migrations
EXPOSE 3004
CMD ["node", "backend/dist/index.js"]
