import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { me, mockCommunity, proposalTitle, sampleDetail, threadId, topic } from './fixtures';

async function screenshot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  // A fixed dialog exists only within the viewport. A full-document capture
  // would misleadingly show uncovered off-screen content beneath the backdrop.
  const modal = await page.getByRole('dialog').count() > 0;
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: !modal });
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('actual public routes render on desktop and mobile', async ({ page }, info) => {
  await mockCommunity(page, { authenticated: false });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('把想法');
  await expect(page.getByRole('link', { name: 'LMM 登录', exact: true })).toHaveAttribute('href', '/auth/login');
  await expect(page.getByRole('heading', { name: topic })).toBeVisible();
  await noOverflow(page); await screenshot(page, info, 'discussion');
  await page.getByRole('link', { name: '知识', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('知识留下来');
  await expect(page.getByRole('heading', { name: 'OIDC 登录与模型调用，是两份不同的授权' })).toBeVisible();
  await noOverflow(page); await screenshot(page, info, 'knowledge');
  await page.getByRole('link', { name: '共识', exact: true }).click();
  await expect(page.getByRole('heading', { name: proposalTitle })).toBeVisible();
  await noOverflow(page); await screenshot(page, info, 'consensus');
});

test('filter, search and clear change actual API queries', async ({ page }) => {
  await mockCommunity(page); await page.goto('/');
  await page.getByRole('button', { name: '实验', exact: true }).click();
  await expect(page).toHaveURL(/kind=experiment/);
  await expect(page.locator('.thread-row')).toHaveCount(2);
  await page.getByRole('textbox', { name: '搜索讨论' }).fill('没有对应的词');
  await page.getByRole('button', { name: '执行搜索' }).click();
  await expect(page.getByRole('heading', { name: '这条线索，还没有结果。' })).toBeVisible();
  await page.getByRole('button', { name: '清除搜索' }).click();
  await expect(page.locator('.thread-row')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: '搜索讨论' })).toHaveValue('');
});

test('pagination is functional rather than decorative', async ({ page }) => {
  await mockCommunity(page, { many: true }); await page.goto('/');
  await expect(page.locator('.thread-row')).toHaveCount(30);
  await page.getByRole('button', { name: '下一页' }).click();
  await expect(page).toHaveURL(/offset=30/);
  await expect(page.locator('.thread-row')).toHaveCount(5);
  await expect(page.getByRole('button', { name: '下一页' })).toBeDisabled();
  await page.getByRole('button', { name: '上一页' }).click();
  await expect(page.locator('.thread-row')).toHaveCount(30);
});

test('compose, preview and publish use the existing command contract', async ({ page }, info) => {
  const fixture = await mockCommunity(page); await page.goto('/');
  await page.getByRole('button', { name: '发起讨论', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('把失败案例也记录下来');
  await page.locator('#body-editor').fill('## 复现步骤\n\n先记录工具返回值，再对照权限。');
  await page.getByRole('radio', { name: '实验记录', exact: true }).check();
  await page.getByRole('button', { name: '预览正文' }).click();
  await expect(page.getByRole('heading', { name: '复现步骤' })).toBeVisible();
  if (info.project.name === 'desktop') await page.getByRole('button', { name: '分栏预览' }).click();
  await noOverflow(page); await screenshot(page, info, 'composer');
  await page.getByRole('button', { name: '发布讨论', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('把失败案例也记录下来');
  expect(fixture.writes).toHaveLength(1);
  expect(fixture.writes[0].csrf).toBe(me.csrf);
  expect(fixture.writes[0].command).toMatchObject({ action: 'create_thread', kind: 'experiment' });
  expect(fixture.writes[0].idempotency_key.length).toBeGreaterThan(8);
});

test('edit conflicts preserve the original revision and draft', async ({ page }) => {
  const fixture = await mockCommunity(page); await page.goto(`/threads/${threadId}`);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '接着修改这份记录。', exact: true });
  const confirmation = page.getByRole('dialog', { name: '保留未提交的内容？', exact: true });
  await page.locator('#body-editor').fill('我的修改不能被静默覆盖。');
  fixture.details.get(threadId)!.thread.revision = 2;
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('原文已更新');
  await expect(page.locator('#body-editor')).toHaveValue('我的修改不能被静默覆盖。');
  expect(fixture.writes[0].command).toMatchObject({ action: 'edit', expected_revision: 1 });
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '继续编辑', exact: true }).click();
  // Wait for the confirmation's exit animation, then target the editor rather
  // than a global Close selector that can match both dialogs during transition.
  await expect(confirmation).toHaveCount(0);
  await expect(page.locator('#body-editor')).toHaveValue('我的修改不能被静默覆盖。');
  await editor.getByRole('button', { name: '关闭', exact: true }).click();
  await confirmation.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('retry after a network failure reuses the same write identity', async ({ page }) => {
  await mockCommunity(page); await page.goto(`/threads/${threadId}`);
  const keys: string[] = [];
  await page.route('**/api/commands', async route => {
    keys.push(route.request().postDataJSON().idempotency_key);
    if (keys.length === 1) return route.abort('failed');
    return route.fulfill({ json: { id: 'reply-fixture-retried' } });
  });
  await page.getByRole('textbox', { name: '补上你的那一段。' }).fill('重试不应重复发布。');
  await page.getByRole('button', { name: '发布回复' }).click();
  await expect(page.locator('.reply-form').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('textbox', { name: '补上你的那一段。' })).toHaveValue('重试不应重复发布。');
  await page.getByRole('button', { name: '发布回复' }).click();
  await expect(page.getByText('回复已发布。', { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
});

test('thread tools, AI draft and replies remain connected', async ({ page }, info) => {
  const fixture = await mockCommunity(page); await page.goto(`/threads/${threadId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(topic);
  await page.getByRole('button', { name: /讨论地图/ }).click();
  await expect(page.getByRole('region', { name: 'AI 生成结果' })).toContainText('浏览器测试返回的 AI 草稿');
  await page.getByRole('button', { name: /检查证据/ }).click();
  await expect(page.getByRole('heading', { name: '需要核实的证据' })).toBeVisible();
  await page.getByRole('button', { name: /^提案草稿/ }).click();
  await expect(page.getByRole('heading', { name: '待讨论的提案' })).toBeVisible();
  expect(fixture.aiCalls).toEqual(['map', 'review', 'proposal']);
  await noOverflow(page); await screenshot(page, info, 'thread');
  await page.getByRole('textbox', { name: '补上你的那一段。' }).fill('补充一个有来源的测试结果。');
  await page.getByRole('button', { name: '发布回复' }).click();
  await expect(page.locator('.reply').getByText('补充一个有来源的测试结果。')).toBeVisible();
  await expect(page.getByRole('region', { name: 'AI 生成结果' })).toHaveCount(0);
});

test('proposal voting calls the authorized shared-account command', async ({ page }) => {
  const fixture = await mockCommunity(page); await page.goto('/consensus');
  await page.getByRole('region', { name: proposalTitle }).getByRole('button', { name: '支持', exact: true }).click();
  await expect(page.getByText('已记录本次选择。人和 AI 使用的仍是同一张票。')).toBeVisible();
  expect(fixture.writes[0].command).toMatchObject({ action: 'vote', choice: 'support' });
  await page.getByRole('button', { name: '已截止', exact: true }).click();
  await expect(page.getByRole('heading', { name: '这里还没有对应的提案。' })).toBeVisible();
});

test('account panel has a real endpoint, export, clipboard fallback and focus return', async ({ page }, info) => {
  await mockCommunity(page); await page.goto('/');
  const opener = page.getByRole('button', { name: '账号与 AI', exact: true });
  await opener.click();
  await expect(page.getByRole('textbox', { name: '远程 MCP 地址' })).toHaveValue('http://127.0.0.1:4173/mcp');
  await expect(page.getByRole('link', { name: '导出内容与操作记录' })).toHaveAttribute('href', '/api/export');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('permission denied'); } } }));
  await page.getByRole('button', { name: '复制 MCP 地址' }).click();
  await expect(page.getByRole('alert')).toContainText('手动复制');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } } }));
  await page.getByRole('button', { name: '复制 MCP 地址' }).click();
  await expect(page.getByText('已复制 MCP 地址', { exact: true })).toBeVisible();
  await noOverflow(page); await screenshot(page, info, 'settings');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(opener).toBeFocused();
});

test('anonymous MCP setup still requires LMM login for identity', async ({ page }) => {
  await mockCommunity(page, { authenticated: false }); await page.goto('/');
  await page.getByRole('button', { name: '接入 AI' }).click();
  await expect(page.getByRole('dialog').getByRole('link', { name: '使用 LMM 登录' })).toHaveAttribute('href', '/auth/login');
  await expect(page.getByRole('textbox', { name: '远程 MCP 地址' })).toBeVisible();
});

test('loading failures never turn into fake discussions', async ({ page }) => {
  await mockCommunity(page);
  await page.route('**/api/threads?*', route => route.fulfill({ status: 503, json: { error: 'storage_unavailable' } }));
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('内容服务暂时不可用');
  await expect(page.locator('.thread-row')).toHaveCount(0);
});

test('empty state is honest and still has a working composer', async ({ page }) => {
  await mockCommunity(page, { empty: true }); await page.goto('/');
  await expect(page.getByRole('heading', { name: '第一条讨论，从真实的问题开始。' })).toBeVisible();
  await page.getByRole('button', { name: '发起讨论', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('motion can be paused and honors reduced-motion changes', async ({ page }) => {
  await mockCommunity(page); await page.goto('/');
  await page.getByRole('button', { name: '暂停动效' }).click();
  await expect(page.locator('.loom')).toHaveAttribute('data-motion', 'paused');
  await page.getByRole('button', { name: '播放动效' }).click();
  await expect(page.locator('.loom')).toHaveAttribute('data-motion', 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.loom')).toHaveAttribute('data-motion', 'reduced');
  await expect(page.getByRole('button', { name: '动效已随系统关闭' })).toBeDisabled();
});

test('responsive widths do not introduce horizontal scrolling', async ({ page }) => {
  await mockCommunity(page); await page.goto('/');
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({ width, height: 900 }); await noOverflow(page); }
});

test('untrusted Markdown cannot execute or load remote tracking images', async ({ page }) => {
  await mockCommunity(page);
  const unsafe = { ...sampleDetail, thread: { ...sampleDetail.thread, body: '<script>window.__unsafe = true</script>\n\n[bad](javascript:alert(1))\n\n![外部图片](https://tracker.invalid/pixel)' } };
  await page.route(`**/api/threads/${threadId}`, route => route.fulfill({ json: unsafe }));
  await page.goto(`/threads/${threadId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(topic);
  await expect(page.locator('.article-content img')).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => '__unsafe' in window)).toBe(false);
});
