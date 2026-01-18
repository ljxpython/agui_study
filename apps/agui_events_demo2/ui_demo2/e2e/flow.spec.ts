import { test, expect } from '@playwright/test';

test.describe('Route 2 E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8123');
  });

  test('should load the application', async ({ page }) => {
    await expect(page.locator('body')).toBeVisible();
  });

  test('should have SSE connection functionality', async ({ page }) => {
    const hasSSE = await page.evaluate(() => {
      return typeof window.EventSource !== 'undefined';
    });
    expect(hasSSE).toBe(true);
  });

  test('should handle chat input', async ({ page }) => {
    await page.fill('input[type="text"]', 'Test message');
    await page.click('button[type="submit"]');

    await page.waitForTimeout(2000);

    const messageExists = await page.locator('text=Test message').isVisible();
    expect(messageExists).toBe(true);
  });

  test('should display AI response', async ({ page }) => {
    await page.fill('input[type="text"]', 'Hello AI');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="ai-message"]', { timeout: 10000 });

    const aiMessage = page.locator('[data-testid="ai-message"]');
    await expect(aiMessage).toContainText('Hello');
  });
});
