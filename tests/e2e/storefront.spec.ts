import { test, expect } from '@playwright/test';

test('public catalog JSON contains no price or private inventory fields', async ({ request }) => {
  const response = await request.get('/catalog.json');
  expect(response.ok()).toBe(true);
  const catalog = await response.json();
  expect(catalog.products.length).toBeGreaterThan(0);
  const forbidden = /price|cost|balance|on_hand|reserved|customer|email|phone/i;
  function inspect(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        expect(key).not.toMatch(forbidden);
        inspect(child);
      }
    }
  }
  inspect(catalog.products);
});

test('public product page does not expose prices or allow illustrative orders', async ({ page }) => {
  await page.goto('/products/wheat-bran/');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('[data-price], [data-unit-price]')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('₹');
  await expect(page.locator('[data-add-package]')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('public storefront renders and fits the viewport', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your next feed order starts here.');
  await expect(page.locator('footer.hire-me, footer .hire-me').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Browse bags' }).click();
  await expect(page.getByRole('searchbox', { name: 'Find a bag or product' })).toBeVisible();
});

test('catalog search filters and clears without a backend', async ({ page }) => {
  await page.goto('/products/');
  const search = page.getByRole('searchbox', { name: 'Find a bag or product' });
  await search.fill('no-such-product-xyz');
  await expect(page.locator('[data-product-card]:visible')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'No bags match this search' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.locator('[data-product-card]:visible').first()).toBeVisible();
});

test('header search and feed discovery reach filtered catalog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search feed and wholesale products' }).fill('choker');
  await page.getByRole('search', { name: 'Search shop' }).getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/\/products\/\?q=choker/);
  await expect(page.locator('[data-product-card]:visible').first()).toBeVisible();
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Feed essentials' }).getByRole('link', { name: /Choker & bran/ }).click();
  await expect(page.getByRole('searchbox', { name: 'Find a bag or product' })).toHaveValue('bran');
  await expect(page.locator('[data-product-card]:visible').first()).toBeVisible();
});

test('redesigned home remains usable in dark mode', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.feed-board')).toBeVisible();
  await expect(page.locator('.bag-scene')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('redesigned-home.png'), fullPage: true });
});

test('customer shell protects private history without sign-in', async ({ page }) => {
  await page.goto('/app/#orders');
  await expect(page.getByRole('heading', { name: 'Your history belongs to you.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Switch to admin' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
