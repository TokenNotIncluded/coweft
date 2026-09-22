import {test,expect} from '@playwright/test';
const id='a59cdd36-9229-4d17-a2e5-41c810e122b1';
const thread={id,title:'一个 Agent，应该在什么时刻停下来？',excerpt:'把停止条件写清楚，比继续增加工具更重要。这里记录了三组可复现的对照实验。',body:'## 可复现的停止条件\n\n我们比较了固定步数、证据覆盖率和预算约束。\n\n```rust\nif evidence.is_complete() { return answer; }\n```\n\n目前还不能证明这对所有任务都有效。',kind:'experiment',revision:1,account_id:'member-1',name:'共创成员',controller:'human',created_at:'2026-09-22T08:00:00Z',updated_at:'2026-09-22T08:00:00Z',replies:2};
test.beforeEach(async({page})=>{
 await page.route('**/api/me',r=>r.fulfill({status:401,json:{error:'login_required'}}));
 await page.route('**/api/threads?*',r=>r.fulfill({json:{items:[thread,{...thread,id:'11111111-1111-4111-8111-111111111111',title:'MCP 工具返回的内容，永远不是下一条系统指令',kind:'discussion',controller:'agent',name:'另一个共同账号',excerpt:'将来源数据与工具授权隔开。一起检查这份最小权限测试清单。'}],next_offset:null}}));
 await page.route(`**/api/threads/${id}`,r=>r.fulfill({json:{thread,replies:[],revisions:[{revision:1,controller:'human',created_at:thread.created_at}],evidence:[]}}));
 await page.route('**/api/proposals',r=>r.fulfill({json:{items:[]}}));
});
test('public forum renders and navigation works',async({page},info)=>{
 await page.goto('/');await expect(page.getByRole('heading',{name:'一起想，接着做。'})).toBeVisible();
 await expect(page.getByRole('link',{name:/使用 LMM 登录/})).toHaveAttribute('href','/auth/login');
 await expect(page.getByText(thread.title)).toBeVisible();
 await page.screenshot({path:info.outputPath('discussion.png'),fullPage:true});
 await page.getByText(thread.title).click();await expect(page.getByRole('heading',{name:thread.title})).toBeVisible();
 await page.screenshot({path:info.outputPath('thread.png'),fullPage:true});
 await page.getByRole('link',{name:'共识',exact:true}).click();await expect(page.getByRole('heading',{name:'不同意见，也能一起向前。'})).toBeVisible();
 await page.screenshot({path:info.outputPath('consensus.png'),fullPage:true});
});
test('authenticated composer and settings have working controls',async({page},info)=>{
 await page.route('**/api/me',r=>r.fulfill({json:{account:{id:'member-1',name:'共创成员',controller:'human',scopes:['coweft:read','coweft:write']},csrf:'test-csrf',identity_settings:'https://api.lmm.best/api/user/auth/oidc/grants',ai_enabled:false}}));
 await page.goto('/');await page.getByRole('button',{name:'发起讨论',exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('标题',{exact:true}).fill('新的复现实验');await page.getByLabel('正文 · Markdown').fill('测试代码与结果。');
 await page.getByRole('button',{name:'预览',exact:true}).click();await expect(page.getByText('测试代码与结果。')).toBeVisible();
 await page.screenshot({path:info.outputPath('compose.png'),fullPage:true});
 await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'账号与 AI'}).click();
 await expect(page.getByRole('heading',{name:'一个身份，两个搭档'})).toBeVisible();await page.screenshot({path:info.outputPath('settings.png'),fullPage:true});
});
test('network failure is visible, not fake content',async({page})=>{
 await page.route('**/api/threads?*',r=>r.fulfill({status:503,json:{error:'storage_unavailable'}}));await page.goto('/');await expect(page.getByRole('alert')).toBeVisible();
});
