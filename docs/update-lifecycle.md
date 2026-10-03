# Update lifecycle

An OTA update moves through a fixed set of states. Each row in the UI sits at exactly one of them; transitions are triggered by CI (publish, finalize) or by a maintainer in the UI (promote, cancel, rollback).

```mermaid
flowchart LR
    publish([CI: publish]) --> draft
    draft -->|cancel-draft\n(CI)| canceled
    draft -->|finalize\n(CI)| staging
    draft -->|finalize\n(no staging cohort)| canary
    draft -->|finalize\n(no staging or canary)| released

    staging -->|cancel| canceled
    staging -->|promote| canary
    staging -->|promote target=released\nor canary cohort empty| released

    canary -->|cancel| canceled
    canary -->|promote| released

    released -->|new release supersedes\nsame channel/platform/runtime| superseded[released · superseded]
    released -->|rollback\n(live release only)| rolledBack[rolled-back]
    rolledBack -.->|republish prior assets| released
    staging -.->|new staging arrives\n(auto-supersede)| supersededStaging[staging · superseded]
    canary -.->|new canary arrives\n(auto-supersede)| supersededCanary[canary · superseded]

    classDef terminal fill:#eee,stroke:#999;
    classDef live fill:#cfe9d4,stroke:#2f855a;
    class canceled,rolledBack,superseded,supersededStaging,supersededCanary terminal
    class released live
```

## State reference

| State                 | Meaning                                                                                                                                        | Who can move it                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `draft`               | Asset uploads are still in flight. Created by `mobile-update publish`.                                                                         | CI only (finalize / cancel-draft)              |
| `staging`             | Finalized and visible to the staging cohort.                                                                                                   | Maintainer (promote / cancel), CI (promote-ci) |
| `canary`              | Visible to staging + canary cohorts.                                                                                                           | Maintainer (promote / cancel), CI (promote-ci) |
| `released`            | Visible to all devices on this channel + platform + runtime version.                                                                           | Maintainer (rollback)                          |
| `<tier> · superseded` | Was live in `staging`, `canary`, or `released`, but a newer entry for the same channel + platform + runtime version took its place. Read-only. | Auto                                           |
| `rolled-back`         | Was the live release; a maintainer rolled it back. The prior release (if any) is republished as a new live update.                             | Auto (after rollback)                          |
| `canceled`            | Hidden from the UI list. End state.                                                                                                            | Maintainer / CI                                |

## Supersession scope

Supersession is scoped to **(channel, platform, runtime version)** — the same scope the manifest endpoint uses when selecting which update to serve a device. Releasing a runtime-2.0 build does not supersede a still-serving runtime-1.0 release on the same channel.

Newest wins, per tier: when a new update lands in `staging`, `canary`, or `released` in a given scope, any prior live entry **in the same tier** is auto-superseded. Different tiers do not collide — a `released` row can coexist with a newer `staging` row for the same scope until the staging row is promoted forward.

Tier transitions are serialized by a `(channel, platform, runtimeVersion)` mutex, so two concurrent CI finalizes against the same branch can't both end up live in the same tier.

## Rollback

Only the **live** release (status `released`, not yet superseded) shows a Rollback button. Rolling back:

1. Marks the live release as `rolled-back`.
2. Republishes the most recent prior release in the same scope with a new UUID and creation time, reusing its asset contents. The original row remains superseded. Expo requires a newer manifest and treats an update UUID as immutable, so simply serving the original manifest cannot undo a downloaded update.

If there is no prior release in scope, the manifest endpoint serves Expo's `rollBackToEmbedded` directive with a stable `parameters.commitTime` newer than the revoked release. It returns the app to the bundle embedded in the installed binary, after the client fetches the directive and reloads. This differs from returning `noUpdateAvailable`, which leaves the current downloaded update running.

Republications retain their original source in `rollbackSourceId`. Rolling back a republication excludes that source from further restoration, allowing successive rollbacks to walk backward through release history.

Rollbacks accepted by older MUS versions can leave an older release restored without a new identity. The manifest endpoint serves an embedded rollback for that legacy state. A newer eligible update supersedes the directive. Rollback selection is scoped to app, channel, platform, and runtime; superseded staging/canary updates are excluded.

The client must handle `isRollBackToEmbedded` separately from `isAvailable` and `isNew`: Expo sets both of the latter flags to `false` for an embedded rollback. `checkForUpdateAsync()` alone does not apply it; fetch and reload are required. Expo can reject a directive when there is no embedded bundle or its selection policy does not allow the rollback.
