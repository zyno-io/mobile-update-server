import { expect, test } from '@playwright/test';

import { VRT_NOW } from './fixtures';
import { expectMinScreenshotSize, mockAdminVcsRoutes, setupAuth, setupBaseMocks } from './helpers';

const SCREENSHOTS_DIR = 'screenshots';

test('admin vcs integrations page', async ({ page }) => {
    await page.clock.install({ time: VRT_NOW });
    await setupAuth(page);
    await setupBaseMocks(page);
    await mockAdminVcsRoutes(page);

    await page.goto('/admin/vcs-integrations');

    await expect(page.getByRole('heading', { name: 'VCS integrations' })).toBeVisible();
    await expect(page.locator('.list .row')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Add integration' })).toBeVisible();
    await page.waitForTimeout(300);

    const path = `${SCREENSHOTS_DIR}/admin-vcs-integrations.png`;
    await page.screenshot({ path, fullPage: true });
    expectMinScreenshotSize(path, 10_000);
});
