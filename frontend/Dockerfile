FROM node:22-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@11.7.0
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY schloss-ui/package.json ./schloss-ui/
COPY schloss-server-kit/package.json ./schloss-server-kit/
RUN apk add --no-cache python3 make g++
RUN pnpm install --frozen-lockfile --filter frontend --filter @zudar107/schloss-ui
COPY schloss-ui ./schloss-ui
RUN pnpm --filter @zudar107/schloss-ui build
ARG VITE_SCHLUSSEL_URL=http://localhost:4001
ENV VITE_SCHLUSSEL_URL=$VITE_SCHLUSSEL_URL
ARG VITE_SCHLOSS_URL=http://localhost:3000
ENV VITE_SCHLOSS_URL=$VITE_SCHLOSS_URL
COPY frontend ./frontend
RUN pnpm --filter frontend build

FROM caddy:2-alpine AS runner
COPY --from=builder /app/frontend/dist /srv
COPY frontend/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
