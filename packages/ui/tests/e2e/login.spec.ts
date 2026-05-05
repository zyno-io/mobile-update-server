import { expect, test } from '@playwright/test';

import { VRT_NOW } from './fixtures';
import { expectMinScreenshotSize, mockLoginRoutes, setupBaseMocks } from './helpers';

const SCREENSHOTS_DIR = 'screenshots';

test('login page', async ({ page }) => {
    await page.clock.install({ time: VRT_NOW });
    // Important: do NOT call setupAuth — login is the unauthenticated state.
    await setupBaseMocks(page);
    await mockLoginRoutes(page);

    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue with GitLab Cloud/i })).toBeVisible();
    await page.waitForTimeout(300);

    const path = `${SCREENSHOTS_DIR}/login.png`;
    await page.screenshot({ path, fullPage: true });
    expectMinScreenshotSize(path, 8_000);
});
