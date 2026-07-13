import { expect, test } from '@playwright/test';

import { ids, VRT_NOW } from './fixtures';
import { expectMinScreenshotSize, mockChannelDetailRoutes, setupAuth, setupBaseMocks } from './helpers';

const SCREENSHOTS_DIR = 'screenshots';

test('channel detail page', async ({ page }) => {
    await page.clock.install({ time: VRT_NOW });
    await setupAuth(page);
    await setupBaseMocks(page);
    await mockChannelDetailRoutes(page);

    await page.goto(`/apps/${ids.appId}/channels/${ids.channelId}`);

    await expect(page.getByRole('heading', { name: 'production', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'OTA updates' })).toBeVisible();
    // Each column defaults to its latest binary version (1.4.0), which hides the two 1.3.0 updates.
    await expect(page.locator('.update')).toHaveCount(5);
    await expect(page.locator('.platform-card')).toHaveCount(2);
    await expect(page.locator('.version-filter').first()).toHaveValue('1.4.0');
    await page.waitForTimeout(300);

    const path = `${SCREENSHOTS_DIR}/channel.png`;
    await page.screenshot({ path, fullPage: true });
    expectMinScreenshotSize(path, 15_000);

    // The page also renders three VfModal dialogs that the screenshot above never opens. Capture
    // each modal card (.vf-modal) on its own so PixelCI diffs modal layout in isolation from the
    // channel page behind the dimmed backdrop. A taller viewport keeps the Settings modal within
    // .vf-modal's max-height: 95% so it is captured in full rather than clipped — the modal content
    // does not scroll internally.
    await page.setViewportSize({ width: 1280, height: 1600 });

    const modal = page.locator('.vf-modal');

    async function captureModal(openName: string, headingName: string, file: string): Promise<void> {
        await page.getByRole('button', { name: openName }).click();
        await expect(modal).toBeVisible();
        await expect(modal.getByRole('heading', { name: headingName })).toBeVisible();
        await page.waitForTimeout(300); // let FontAwesome glyphs settle so the capture is stable

        const modalPath = `${SCREENSHOTS_DIR}/${file}`;
        await modal.screenshot({ path: modalPath });
        expectMinScreenshotSize(modalPath, 5_000);

        await modal.getByRole('button', { name: 'Cancel' }).click();
        await expect(modal).toBeHidden();
    }

    await captureModal('Staging cohort', 'Staging cohort', 'channel-cohort-staging.png');
    await captureModal('Canary cohort', 'Canary cohort', 'channel-cohort-canary.png');
    await captureModal('Settings', 'Channel settings', 'channel-settings.png');

    // The binary history modal closes via "Close", not "Cancel", so it gets its own capture.
    await page.locator('.platform-card').first().getByRole('button', { name: 'History' }).click();
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: 'iOS binary history' })).toBeVisible();
    // Three iOS builds — 1.4.0 twice (a rebuild with a second fingerprint) plus 1.3.0.
    await expect(modal.locator('.build')).toHaveCount(3);
    await page.waitForTimeout(300);

    const historyPath = `${SCREENSHOTS_DIR}/channel-binary-history.png`;
    await modal.screenshot({ path: historyPath });
    expectMinScreenshotSize(historyPath, 5_000);

    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toBeHidden();
});

test('binary version filter narrows each platform column independently', async ({ page }) => {
    await page.clock.install({ time: VRT_NOW });
    await setupAuth(page);
    await setupBaseMocks(page);
    await mockChannelDetailRoutes(page);

    await page.goto(`/apps/${ids.appId}/channels/${ids.channelId}`);
    await expect(page.locator('.update')).toHaveCount(5);

    const iosColumn = page.locator('.updates-column').first();
    const androidColumn = page.locator('.updates-column').nth(1);
    await expect(iosColumn.locator('.update')).toHaveCount(2);
    await expect(androidColumn.locator('.update')).toHaveCount(3);

    // "All versions" reveals the update built against the older 1.3.0 binary...
    await iosColumn.locator('.version-filter').selectOption('');
    await expect(iosColumn.locator('.update')).toHaveCount(3);
    // ...and leaves the other platform's column untouched.
    await expect(androidColumn.locator('.update')).toHaveCount(3);

    // Selecting the older binary explicitly shows only its update.
    await iosColumn.locator('.version-filter').selectOption('1.3.0');
    await expect(iosColumn.locator('.update')).toHaveCount(1);
    await expect(iosColumn.getByText('v139')).toBeVisible();
    await expect(androidColumn.locator('.update')).toHaveCount(3);
});

test('a binary version with no updates shows an empty column, not the CI empty state', async ({ page }) => {
    await page.clock.install({ time: VRT_NOW });
    await setupAuth(page);
    await setupBaseMocks(page);
    await mockChannelDetailRoutes(page);
    // No updates were ever built against this iOS binary.
    await page.route(/\/updates\?.*binaryVersion=1\.4\.0.*platform=ios|\/updates\?.*platform=ios.*binaryVersion=1\.4\.0/, route =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );

    await page.goto(`/apps/${ids.appId}/channels/${ids.channelId}`);

    const iosColumn = page.locator('.updates-column').first();
    await expect(iosColumn.getByText('No updates for binary version 1.4.0.')).toBeVisible();
    // The "push from your CI" block is only for a channel with no updates at all.
    await expect(page.locator('.empty-block')).toHaveCount(0);
    await expect(page.locator('.updates-column').nth(1).locator('.update')).toHaveCount(3);
});
