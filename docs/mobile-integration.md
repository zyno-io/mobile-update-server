# Mobile integration

How to point an Expo app at this server for OTA updates, target a device for canary releases, and check whether a native (App Store / Play Store) update is required.

## 1. Configure `expo-updates`

This server speaks Expo Updates protocol v1. Point your app's `app.json` (or `app.config.js`) at it:

```jsonc
{
    "expo": {
        "name": "MyApp",
        "slug": "my-app",
        "runtimeVersion": { "policy": "fingerprint" },
        "updates": {
            "url": "https://updates.example.com/api/manifest/<APP_ID>",
            "enabled": true,
            "checkAutomatically": "ON_LOAD",
            "fallbackToCacheTimeout": 0,
            "requestHeaders": {
                "expo-channel-name": "<CHANNEL_ID>"
            }
        }
    }
}
```

`<APP_ID>` and `<CHANNEL_ID>` are the UUIDs shown in the UI (app page and channel page). Despite the header being named `expo-channel-name` in Expo's spec, this server keys off channel _id_ — paste the channel UUID, not its display name. Channels can be renamed without breaking shipped apps; if you key off the name, a rename takes everyone offline.

> **`runtimeVersion`** — match what your CI passes to `mobile-update publish --runtime-version=...`. If you use `{ "policy": "fingerprint" }`, the publish step computes the same fingerprint that's recorded on each binary build (`record-binary --fingerprint=...`), so OTAs reach the right binaries.

## 2. Build with EAS / locally

Nothing special — `expo-updates` reads the manifest URL from `app.json` and ships it into the bundle. CI uploads OTAs separately via the [`mobile-update` CLI](../README.md#using-the-cli-in-gitlab-ci).

## 3. Tag a device for canary updates

Canary updates target devices by ID. The mobile app sends the ID in the `mus-device-id` request header on every check-in:

```ts
import * as Updates from 'expo-updates';
import * as Application from 'expo-application';

// Pick any stable per-install identifier you can recover later. `getIosIdForVendorAsync`
// and `getAndroidId` return install-stable values; use whatever your privacy review allows.
const deviceId = (await Application.getIosIdForVendorAsync()) ?? Application.getAndroidId() ?? 'unknown';

await Updates.setUpdateRequestHeadersOverride({ 'mus-device-id': deviceId });
```

Paste that ID into **Edit canary devices** in the UI for the channel. On the next check-in, that device will receive the canary update; everyone else gets the latest released update for the same runtime version.

## 4. Check whether a native update is required

Channel settings in the UI let you mark a native update as required, either:

- **Immediate** — the current store version becomes required now, and future store versions become required as soon as they are detected.
- **N days after a new store version is detected** — every detected store version gets its own deadline at `firstDetectedAt + N days`.

These are persistent channel policies. A delayed policy remains delayed after its current deadline passes, and a newly detected store version always receives a fresh deadline. Changing the policy or number of days recalculates the deadline for the latest detected store version. If no store version has been detected yet, the policy is retained and activates on the first detection.

The mobile app checks this against a public endpoint:

```http
GET /api/manifest/{appId}/native-status?channelId={channelId}&platform={ios|android}
```

Response:

```jsonc
{
    "platform": "ios",
    "channelId": "a12ee986-1df2-47fb-b25e-6113a1deffb1",
    "nativeUpdateRequiredAt": "2026-05-15T17:30:00.000Z", // null when not configured
    "nativeUpdateRequired": true, // requiredAt <= now
    "latestStoreVersion": "3.4.1", // null if not tracked / not detected yet
    "latestStoreVersionDetectedAt": "2026-05-01T17:30:00.000Z",
    "storeUrl": "https://apps.apple.com/us/app/myapp/id1234567890" // null until first store lookup succeeds
}
```

No auth — this endpoint is intended for unauthenticated mobile clients.

### Example client code

```ts
import * as Updates from 'expo-updates';
import * as Application from 'expo-application';
import { Linking, Platform } from 'react-native';

const APP_ID = '11111111-1111-1111-1111-111111111111';
const CHANNEL_ID = 'a12ee986-1df2-47fb-b25e-6113a1deffb1';
const SERVER_URL = 'https://updates.example.com';

interface NativeStatus {
    nativeUpdateRequiredAt: string | null;
    nativeUpdateRequired: boolean;
    latestStoreVersion: string | null;
    latestStoreVersionDetectedAt: string | null;
    storeUrl: string | null;
}

export async function checkNativeUpdate(channelId: string): Promise<NativeStatus> {
    const url = `${SERVER_URL}/api/manifest/${APP_ID}/native-status?channelId=${encodeURIComponent(channelId)}&platform=${Platform.OS}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`native-status ${res.status}`);
    return res.json();
}

export async function enforceNativeUpdate(status: NativeStatus, currentVersion: string): Promise<boolean> {
    if (!status.nativeUpdateRequired) return false;

    // If the user is already on the latest store version, no need to nag.
    if (status.latestStoreVersion && status.latestStoreVersion === currentVersion) return false;

    if (status.storeUrl) Linking.openURL(status.storeUrl);
    return true;
}

// Wire it into app startup
const status = await checkNativeUpdate(CHANNEL_ID);
const blocked = await enforceNativeUpdate(status, Application.nativeApplicationVersion ?? '0');
if (blocked) {
    // render a "please update" screen and bail before mounting your app
}
```

You can call this on a timer too (e.g. every hour from a foreground task) to catch users whose deadline elapses while the app is open.

### Where do the values come from?

- `latestStoreVersion` is detected by the server polling the App Store / Play Store hourly, _or_ as soon as you save channel settings (the save triggers an immediate lookup).
- Store-version history is scoped to the configured bundle ID or package name. Changing that identifier starts a fresh detection history, even if the new app currently has the same version string.
- `nativeUpdateRequiredAt` belongs to the latest detected store version. The server calculates it from the persistent **Channel settings → Force native update** policy, so delayed deadlines are always anchored to when that specific store version was first seen.

## 5. Reading manifest extras

When an OTA does load, anything in `extra` on the manifest is available via `Updates.manifest.extra`. Today the server only puts the published `app.config` there (when present); the native-status endpoint above is the supported way to read native update requirements.
