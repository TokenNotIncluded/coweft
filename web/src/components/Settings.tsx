import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, Copy, Download, LogOut, KeyRound } from 'lucide-react';
import { write } from '../api';
import { useMe } from '../hooks/community';
import { ErrorNotice } from './community';
import { Button } from './ui/button';
import { Modal } from './ui/dialog';

const scopeNames: Record<string, string> = { 'coweft:read': '阅读', 'coweft:write': '发布与修改', 'coweft:propose': '提案', 'coweft:vote': '表决' };
export function Settings({ open, close }: { open: boolean; close: () => void }) {
  const me = useMe();
  const client = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const endpoint = `${location.origin}/mcp`;
  const logout = useMutation({
    mutationFn: () => write('/auth/logout', {}, me.data),
    onSuccess: () => { client.clear(); location.assign('/'); },
  });
  const copy = async () => {
    try { await navigator.clipboard.writeText(endpoint); setCopied(true); setError(null); }
    catch { setCopied(false); setError(new Error('无法访问剪贴板。请选中下方地址手动复制。')); }
  };
  return <Modal open={open} onOpenChange={value => { if (!value) close(); }} layout="sheet" title="账号与 AI" description="登录、授权与撤销，由 api.lmm.best 统一处理。">
    <div className="identity-pair"><div><span className="identity-symbol">○</span><span className="mono">HUMAN</span><strong>{me.data?.account.name ?? '你'}</strong><small>{me.data ? '当前共同账号' : '通过 LMM 登录'}</small></div><span className="pair-join" aria-hidden="true">×</span><div><span className="identity-symbol agent-symbol">✳</span><span className="mono">AGENT</span><strong>你的 AI 搭档</strong><small>独立授权 · 共用身份</small></div></div>
    <section className="settings-section"><div className="section-kicker"><span>01</span><h3>接入 AI</h3></div><p>在支持预注册 OAuth 客户端的工具中添加这个 MCP 地址，再去 LMM 确认权限。</p><label className="endpoint-label" htmlFor="mcp-endpoint">远程 MCP 地址</label><div className="copy-field"><input id="mcp-endpoint" value={endpoint} readOnly onFocus={event => event.currentTarget.select()}/><Button variant="ghost" size="icon" aria-label="复制 MCP 地址" onClick={() => { void copy(); }}>{copied ? <Check size={17}/> : <Copy size={17}/>}</Button></div><span className="copy-feedback" role="status">{copied ? '已复制 MCP 地址' : '不需要把浏览器 Cookie 或模型密钥交给 AI。'}</span><details className="settings-details"><summary>连接前需要什么？</summary><p>客户端必须先在 LMM 注册。论坛的阅读、写入、提案和投票分别授权。撤销一份代理授权，不会给这个账号新增或减少票数。</p></details></section>
    <section className="settings-section"><div className="section-kicker"><span>02</span><h3>权限与数据</h3></div>
      {me.data ? <><div className="scope-list" aria-label="当前账号已授权权限">{me.data.account.scopes.filter(scope => scopeNames[scope]).map(scope => <span key={scope}><Check size={12}/>{scopeNames[scope]}</span>)}</div><a className="settings-link" href="https://api.lmm.best/api/user/auth/oidc/grants" target="_blank" rel="noopener noreferrer"><span><KeyRound size={16}/>在 LMM 管理授权</span><ArrowUpRight size={16}/></a><a className="settings-link" href="/api/export"><span><Download size={16}/>导出内容与操作记录</span><ArrowUpRight size={16}/></a><p className="settings-fineprint">公共 AI：{me.data.ai_enabled ? '节点已配置模型' : '节点尚未配置模型'}。模型预算与账号权利无关。</p></> : <><p>共织不创建另一套密码。登录后，人和 AI 的贡献归属同一个账号。</p><a className="button button-primary" href="/auth/login">使用 LMM 登录 <ArrowUpRight size={16}/></a></>}
    </section>
    <ErrorNotice error={error ?? logout.error ?? me.error}/>
    <div className="settings-bottom"><p>人和 AI 不共用密钥。</p>{me.data && <Button variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}><LogOut size={15}/>{logout.isPending ? '退出中…' : '退出会话'}</Button>}</div>
  </Modal>;
}
