# mobile-update-server

A self-hosted Expo Updates server for distributing OTA updates to mobile apps. Inspired by [`expo/custom-expo-updates-server`](https://github.com/expo/custom-expo-updates-server) and built on the same stack as PixelCI.

## Features

- Multiple apps, each with multiple branch-bound channels
- Per-channel, per-platform updates with `staging` / `canary` / `released` lifecycle, supersession, and one-click rollback
- Canary targeting by device ID (sent in the `mus-device-id` request header)
- Device check-in metrics: % checked-in within window, % on a given update
- Per-channel, per-platform **binary build** tracking (latest native version + fingerprint), so you can see what binaries are out there even when no OTA exists for them
- GitLab OIDC login; project-level permissions mirror GitLab
- GitLab CI job-token authenticated uploads (validated via `/api/v4/job` callback)

## Quick start

```bash
yarn install
yarn services:up
yarn migrate
yarn dev:api    # backend on :7935
yarn dev:ui     # ui on :7936
```

## Packages

- `packages/api` — Deepkit + `@zyno-io/ts-server-foundation` backend
- `packages/ui` — Vue 3 + `@zyno-io/vue-foundation` + Tailwind frontend
- `packages/cli` — `mobile-update publish` / `mobile-update promote` / `mobile-update record-binary` for GitLab CI

## Docs

- [Getting started](docs/getting-started.md) — local dev setup, environment variables, and production configuration
- [Update lifecycle](docs/update-lifecycle.md) — draft → staging → canary → released, plus supersession and rollback (with flowchart)
- [Mobile integration](docs/mobile-integration.md) — pointing an Expo app at this server, canary device targeting, and checking native (App Store / Play Store) update requirements from the app

## Versioning

Releases use date-based versioning of the form `YY.MMDD.HHmm` (e.g. `26.509.1432`); each `main` build cuts a new version. The server implements the [Expo Updates protocol](https://docs.expo.dev/technical-specs/expo-updates-1/) and aims to remain compatible with **all versions of `expo-updates`** — server upgrades should never require a client library upgrade.

## Using the CLI in GitLab CI

The CLI ships as a Docker image at `<CI_REGISTRY_IMAGE>/cli:latest` (or pin a `:<BUILD_VERSION>-<SHA>` tag in production). The image puts `mobile-update` on `$PATH`. It auto-detects `CI_JOB_TOKEN` + `CI_PROJECT_URL`.

```yaml
variables:
    MUS_SERVER_URL: https://updates.example.com
    MUS_APP_ID: 11111111-1111-1111-1111-111111111111 # from the UI
    MUS_CHANNEL_ID: 22222222-2222-2222-2222-222222222222 # from the UI

publish iOS OTA:
    image: ghcr.io/zyno-io/mobile-update-server/cli:latest
    script:
        - npx expo export --platform ios
        - mobile-update publish ./dist --platform=ios
        # If your `expo.runtimeVersion` is a policy object (e.g. { policy: "appVersion" }),
        # pass it explicitly: mobile-update publish ./dist --platform=ios --runtime-version=$APP_VERSION

record iOS native build:
    image: ghcr.io/zyno-io/mobile-update-server/cli:latest
    script:
        - mobile-update record-binary --platform=ios --binary-version=$VERSION --fingerprint=$FINGERPRINT

read latest iOS native version:
    image: ghcr.io/zyno-io/mobile-update-server/cli:latest
    script:
        - curl -fsS -H "Authorization: Bearer $CI_JOB_TOKEN" "$MUS_SERVER_URL/api/apps/$MUS_APP_ID/channels/$MUS_CHANNEL_ID/binary-builds/latest-ci?platform=ios"

promote OTA:
    image: ghcr.io/zyno-io/mobile-update-server/cli:latest
    script:
        - mobile-update promote
```

Cross-project image pulls via `CI_JOB_TOKEN` work as long as your project is in this server's job-token allowlist (Settings → CI/CD → Job token permissions).

Each channel is bound to one Git branch. GitLab CI uploads are accepted only when the job token belongs to the app's GitLab project and the job ref matches the channel's branch.

The `fingerprint` is the same string the Expo client sends in `expo-runtime-version`, so OTA updates created with that runtime version will reach devices on this binary.

If you'd rather skip the CLI, these operations are plain REST — see `mobile-update --help` or POST directly to the API.

## Tests

```bash
yarn services:up
yarn migrate
yarn test:int        # 38 integration tests across 6 suites
```
