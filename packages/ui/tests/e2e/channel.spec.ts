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
});
