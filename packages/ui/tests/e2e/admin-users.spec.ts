import { expect, test } from '@playwright/test';

import { VRT_NOW } from './fixtures';
import { expectMinScreenshotSize, mockAdminUsersRoutes, setupAuth, setupBaseMocks } from './helpers';

const SCREENSHOTS_DIR = 'screenshots';

test('admin users page', async ({ page }) => {
    await page.clock.install({ time: VRT_NOW });
    await setupAuth(page);
    await setupBaseMocks(page);
    await mockAdminUsersRoutes(page);

    await page.goto('/admin/users');

    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
    await expect(page.locator('table.users tbody tr')).toHaveCount(4);
    await page.waitForTimeout(300);

    const path = `${SCREENSHOTS_DIR}/admin-users.png`;
    await page.screenshot({ path, fullPage: true });
    expectMinScreenshotSize(path, 10_000);
});
