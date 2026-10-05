FROM node:24-alpine AS builder

WORKDIR /app

RUN corepack enable

COPY .yarn .yarn
COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/api/package.json packages/api/package.json
COPY packages/api/tsconfig*.json packages/api/
COPY packages/ui/package.json packages/ui/package.json
COPY packages/cli/package.json packages/cli/package.json

RUN yarn --immutable

COPY packages/ui packages/ui
COPY packages/api packages/api

RUN cd packages/ui && \
    npx generate-openapi-client && \
    yarn build

RUN cd packages/api && \
    yarn build

RUN yarn workspaces focus @zyno-io/mobile-update-server-api --production

###

FROM node:24-alpine
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache tini

COPY --from=builder /app/packages/api .
COPY --from=builder /app/node_modules node_modules

ARG BUILD_VERSION=0.0.0
RUN npm version ${BUILD_VERSION} --allow-same-version

EXPOSE 7935

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".", "server:start"]
