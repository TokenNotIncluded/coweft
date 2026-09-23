import { test, expect } from '@playwright/test';
import { mockCommunity, topic } from './fixtures';

// Jumping within a preview must not add a history entry, since the preview
// closes by returning to the exact previous search/filter/page URL.
test('jumping to replies preserves one-step preview close', async ({ page }) => {
  await mockCommunity(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?kind=experiment');
  await page.getByRole('heading', { name: topic }).click();
  const reader = page.getByRole('dialog', { name: '讨论预览' });
  await expect(reader.getByRole('heading', { level: 1 })).toHaveText(topic);
  const before = page.url();
  await reader.getByRole('button', { name: '接着讨论', exact: true }).click();
  await expect(page).toHaveURL(before);
  await reader.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(reader).toHaveCount(0);
  await expect(page).toHaveURL('http://127.0.0.1:4173/?kind=experiment');
});
