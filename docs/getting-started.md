# Getting started

This guide walks through running `mobile-update-server` for local development and pointing it at the configuration it expects in production.

## Prerequisites

- Node.js 22+
- Yarn 4 (managed via Corepack — `corepack enable` is enough)
- Docker (for the local MySQL / Redis / S3 services)

## Local development

```bash
yarn install
yarn services:up        # MySQL, Redis, SeaweedFS (S3) on localhost
yarn migrate            # apply DB migrations
yarn dev:api            # backend on http://localhost:7935
yarn dev:ui             # UI on http://localhost:7936
```

The API auto-loads `packages/api/.env.development` and the UI auto-loads `packages/ui/.env.development` when started via `yarn dev:*`. Both files are checked into the repo and point at the local Docker services started by `yarn services:up`. You don't need to copy or rename anything — they "just work" against the default local stack.

If you need to override values locally, create `packages/api/.env.development.local` (or `.env.local` for the UI) — Vite/dotenv will pick those up and they're ignored by git.

## Running the integration tests

```bash
yarn services:up
yarn migrate
yarn workspace @zyno-io/mobile-update-server-api test:int
```

## Production configuration

In production, **nothing is auto-loaded** — `.env.development` is a development convenience only. You're expected to inject the configuration into the container's environment yourself (e.g. via Helm `values.yaml` and a Kubernetes `Secret`, a Docker `--env-file`, your platform's secret store, etc.).

The Helm chart in `resources/helm/chart` is the reference deployment shape — see its `values.yaml` for where each variable lands.

### API environment variables

| Variable                           | Required | Default                 | Notes                                                                                                                     |
| ---------------------------------- | -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_BASE_URL`                  | yes      | `http://localhost:7935` | The externally reachable origin of the API. Used to build absolute asset URLs and OAuth redirects.                        |
| `OAUTH_REDIRECT_ORIGINS`           | yes      | —                       | Comma-separated list of origins allowed to receive the GitLab OIDC redirect (typically the API origin and the UI origin). |
| `AUTH_JWT_SECRET`                  | yes      | —                       | Secret used to sign session JWTs. Generate a long random string and keep it stable across pod replicas.                   |
| `MYSQL_HOST`                       | yes      | —                       | MySQL host.                                                                                                               |
| `MYSQL_PORT`                       | no       | `3306`                  |                                                                                                                           |
| `MYSQL_USER`                       | yes      | —                       |                                                                                                                           |
| `MYSQL_PASSWORD_SECRET`            | yes      | —                       | MySQL password (named `*_SECRET` because it's expected to come from a secret store).                                      |
| `MYSQL_DATABASE`                   | yes      | —                       |                                                                                                                           |
| `S3_ENDPOINT`                      | no       | AWS S3                  | Override for non-AWS S3 (SeaweedFS, MinIO, R2, etc.).                                                                     |
| `S3_REGION`                        | yes      | —                       |                                                                                                                           |
| `S3_BUCKET`                        | yes      | —                       | Bucket where update assets are stored. Must already exist.                                                                |
| `S3_ACCESS_KEY_ID`                 | yes      | —                       |                                                                                                                           |
| `S3_ACCESS_SECRET`                 | yes      | —                       |                                                                                                                           |
| `MAX_ASSET_SIZE_BYTES`             | no       | `52428800` (50 MiB)     | Upload size limit per asset.                                                                                              |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | no       | —                       | JSON for a Google Play service account, used to look up Play Store versions. Omit to disable Play Store polling.          |
| `APPLE_LOOKUP_COUNTRY`             | no       | `us`                    | Storefront country code used when querying the iTunes lookup API.                                                         |
| `STORE_VERSION_POLL_INTERVAL_MS`   | no       | `3600000` (1 h)         | How often the store-version poll job runs.                                                                                |

### UI environment variables

The UI is a static Vue bundle built at image build time. The values below are baked into the bundle by Vite when `yarn build:ui` runs:

| Variable           | Required | Notes                                                       |
| ------------------ | -------- | ----------------------------------------------------------- |
| `VITE_APP_API_URL` | yes      | Origin of the API the UI should talk to.                    |
| `VITE_APP_ENV`     | no       | Free-form environment label (e.g. `production`, `staging`). |

In the default Docker image the UI is served by the API itself, so `VITE_APP_API_URL` is just the public base URL of the API.

## Versioning and Expo Updates compatibility

Releases use date-based versioning of the form `YY.MMDD.HHmm` (e.g. `26.509.1432`). There is no semver — every build on `main` produces a new version, and the timestamp is derived from the CI pipeline's creation time.

The server implements the [Expo Updates protocol](https://docs.expo.dev/technical-specs/expo-updates-1/) and aims to remain compatible with **all versions of `expo-updates`** that the upstream client supports. Upgrades to this server should never require an in-app library upgrade on the client side.
