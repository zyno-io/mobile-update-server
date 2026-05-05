FROM node:24-alpine AS builder

WORKDIR /build

RUN corepack enable

COPY .yarn .yarn
COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/cli/package.json packages/cli/package.json

RUN yarn workspaces focus @zyno-io/mobile-update-server-cli

COPY packages/cli packages/cli
RUN cd packages/cli && yarn build

###

FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache tini

COPY --from=builder /build/packages/cli/dist ./dist
COPY --from=builder /build/packages/cli/package.json ./package.json
COPY --from=builder /build/node_modules ./node_modules

RUN ln -s /app/dist/index.js /usr/local/bin/mobile-update && chmod +x /app/dist/index.js

WORKDIR /workspace
ENTRYPOINT ["/sbin/tini", "--"]
