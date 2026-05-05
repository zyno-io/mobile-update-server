import { expect, test } from '@playwright/test';

import { VRT_NOW } from './fixtures';
import { expectMinScreenshotSize, mockAppsRoutes, setupAuth, setupBaseMocks } from './helpers';

const SCREENSHOTS_DIR = 'screenshots';

test('apps list page', async ({ page }) => {
    await page.clock.install({ time: VRT_NOW });
    await setupAuth(page);
    await setupBaseMocks(page);
    await mockAppsRoutes(page);

    await page.goto('/apps');

    await expect(page.getByRole('heading', { name: 'Apps' })).toBeVisible();
    await expect(page.locator('.app').first()).toBeVisible();
    await expect(page.locator('.app')).toHaveCount(3);
    await page.waitForTimeout(300);

    const path = `${SCREENSHOTS_DIR}/apps.png`;
    await page.screenshot({ path, fullPage: true });
    expectMinScreenshotSize(path, 10_000);
});
