import { expect, test } from '@playwright/test';

import { ids, VRT_NOW } from './fixtures';
import { expectMinScreenshotSize, mockUpdateDetailRoutes, setupAuth, setupBaseMocks } from './helpers';

const SCREENSHOTS_DIR = 'screenshots';

test('update detail page', async ({ page }) => {
    await page.clock.install({ time: VRT_NOW });
    await setupAuth(page);
    await setupBaseMocks(page);
    await mockUpdateDetailRoutes(page);

    await page.goto(`/apps/${ids.appId}/channels/${ids.channelId}/updates/${ids.updateId}`);

    await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible();
    await expect(page.locator('table.assets tbody tr')).toHaveCount(3);
    await page.waitForTimeout(300);

    const path = `${SCREENSHOTS_DIR}/update.png`;
    await page.screenshot({ path, fullPage: true });
    expectMinScreenshotSize(path, 10_000);
});
