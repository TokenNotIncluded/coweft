import { test, expect } from '@playwright/test';
import { mockCommunity, topic } from './fixtures';

// Video is a worker-scoped option, so keep it at file scope instead of a
// describe block. These are actual browser interactions, not concept frames.
test.use({ video: { mode: 'on', size: { width: 1280, height: 900 } } });
test('record actual navigation, AI tools and editing', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Desktop walkthrough; mobile interaction coverage is in forum.spec.ts.');
  await mockCommunity(page); await page.goto('/');
  await expect(page.getByRole('heading', { name: topic })).toBeVisible(); await page.waitForTimeout(1000);
  await page.getByRole('link', { name: '知识', exact: true }).click(); await page.waitForTimeout(650);
  await page.getByRole('link', { name: '共识', exact: true }).click(); await page.waitForTimeout(650);
  await page.getByRole('link', { name: '讨论', exact: true }).click();
  await page.getByRole('heading', { name: topic }).click(); await page.waitForTimeout(750);
  await page.getByRole('button', { name: /讨论地图/ }).click(); await page.waitForTimeout(850);
  await page.getByRole('button', { name: '账号与 AI' }).click(); await page.waitForTimeout(800);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByRole('button', { name: '分栏预览' }).click(); await page.waitForTimeout(1000);
  await expect(page.getByRole('dialog')).toBeVisible();
});
