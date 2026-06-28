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
    await expect(page.locator('.update')).toHaveCount(5);
    await expect(page.locator('.platform-card')).toHaveCount(2);
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
});
