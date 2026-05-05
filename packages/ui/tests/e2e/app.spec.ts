import { expect, test } from '@playwright/test';

import { ids, VRT_NOW } from './fixtures';
import { expectMinScreenshotSize, mockAppDetailRoutes, setupAuth, setupBaseMocks } from './helpers';

const SCREENSHOTS_DIR = 'screenshots';

test('app detail page', async ({ page }) => {
    await page.clock.install({ time: VRT_NOW });
    await setupAuth(page);
    await setupBaseMocks(page);
    await mockAppDetailRoutes(page);

    await page.goto(`/apps/${ids.appId}`);

    await expect(page.getByRole('heading', { name: 'Acme Mobile' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Channels' })).toBeVisible();
    await expect(page.locator('.channel')).toHaveCount(2);
    await page.waitForTimeout(300);

    const path = `${SCREENSHOTS_DIR}/app.png`;
    await page.screenshot({ path, fullPage: true });
    expectMinScreenshotSize(path, 10_000);
});
