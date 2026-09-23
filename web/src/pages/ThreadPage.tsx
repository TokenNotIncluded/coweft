import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, FileText, GitBranch, PenLine, ScanLine } from 'lucide-react';
import { api, write, type Detail, type Thread } from '../api';
import { useCommand, useMe } from '../hooks/community';
import { Button } from '../components/ui/button';
import { Modal } from '../components/ui/dialog';
import { Composer } from '../components/Composer';
import { DateLabel, ErrorNotice, kindLabels, Loading, Provenance, RichText } from '../components/community';

export function ThreadPage({ threadId, embedded = false, onDirtyChange }: { threadId?: string; embedded?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const { id: routeId } = useParams();
  const id = threadId ?? routeId;
  const valid = !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const query = useQuery({ queryKey: ['thread', id], queryFn: ({ signal }) => api<Detail>(`/api/threads/${id}`, { signal }), enabled: valid });
  useEffect(() => { if (query.data) document.title = `${query.data.thread.title} — CoWeft`; }, [query.data]);
  if (!valid) return <ErrorNotice error={new Error('无效的讨论地址')}/>;
  if (query.isPending) return <div className="page"><Loading/></div>;
  if (!query.data) return <div className="page error-page"><Link className="back-link" to="/"><ArrowLeft size={15}/>所有讨论</Link><ErrorNotice error={query.error} retry={() => { void query.refetch(); }}/></div>;
  return <ThreadBody onDirtyChange={onDirtyChange} embedded={embedded} key={query.data.thread.id} data={query.data} refresh={() => { void query.refetch(); }}/>;
}

function ThreadBody({ data, refresh, embedded, onDirtyChange }: { data: Detail; refresh: () => void; embedded: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const { thread, replies, evidence, revisions } = data;
  const me = useMe();
  // Capture the edit base at open time. A background query refresh must NOT
  // silently advance expected_revision while the user's draft stays old.
  const [editing, setEditing] = useState<Thread | null>(null);
  const [proposing, setProposing] = useState(false);
  const [addingEvidence, setAddingEvidence] = useState(false);
  const [reply, setReply] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { onDirtyChange?.(!!reply.trim()); return () => onDirtyChange?.(false); }, [reply, onDirtyChange]);
  const model = useMutation({
    mutationFn: (mode: string) => write<{ content: string; revision: number; model: string }>(`/api/ai/${thread.id}/${mode}`, {}, me.data),
  });
  const command = useCommand((_result, action) => {
    if (action.action === 'reply') { setReply(''); setNotice('回复已发布。'); model.reset(); }
    if (action.action === 'propose') { setProposing(false); setNotice('提案已发布，可前往共识查看。'); }
    if (action.action === 'evidence') { setAddingEvidence(false); setNotice('贡献证据已记录。'); }
  });
  const owner = me.data?.account.id === thread.account_id;
  const act = (callback: () => void) => { if (me.data) { command.reset(); callback(); } else location.assign('/auth/login'); };
  const sendReply = (event: FormEvent) => {
    event.preventDefault();
    if (!command.isPending && reply.trim()) command.mutate({ action: 'reply', thread_id: thread.id, body: reply });
  };
  const generatedStale = !!model.data && model.data.revision !== thread.revision;
  return <article className={`page thread-page ${embedded ? 'embedded-thread' : ''}`}>
    <div className="thread-breadcrumb">{embedded ? <Link className="back-link" to={`/threads/${thread.id}`}><ArrowUpRight size={15}/>在完整页面打开</Link> : <Link className="back-link" to="/"><ArrowLeft size={15}/>所有讨论</Link>}<span className="mono">THREAD / {thread.id.slice(0, 8)}</span></div>
    <div className="article-layout"><div className="article-main">
      <header className="article-heading"><div className="row-meta"><span className={`kind-label kind-${thread.kind}`}>{kindLabels[thread.kind]}</span><Provenance kind={thread.controller}/><span className="mono">REV {String(thread.revision).padStart(2, '0')}</span></div><h1>{thread.title}</h1><div className="article-byline"><span className="identity-avatar" aria-hidden="true">{thread.controller === 'agent' ? '✳' : '○'}</span><span>{thread.name}</span><DateLabel value={thread.created_at}/>{owner && <Button variant="ghost" size="small" onClick={() => setEditing({ ...thread })}><PenLine size={14}/>编辑</Button>}</div></header>
      <div className="article-content"><RichText>{thread.body ?? ''}</RichText></div>
      <div className="article-actions"><Button variant="secondary" onClick={() => act(() => setProposing(true))}><GitBranch size={15}/>发起提案</Button>{!owner && <Button variant="ghost" onClick={() => act(() => setAddingEvidence(true))}>补充贡献证据 <ArrowUpRight size={15}/></Button>}<button type="button" className="text-link" onClick={event => {
        // Scroll locally rather than adding a hash entry to browser history.
        // Otherwise closing an in-place preview could navigate only to its
        // previous hash instead of returning to the preserved discussion list.
        const section = event.currentTarget.closest('article')?.querySelector<HTMLElement>('#replies');
        section?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      }}>接着讨论 <ArrowRight size={15}/></button></div>
      {notice && <p className="success-notice" role="status"><Check size={15}/>{notice}</p>}
      <section className="replies-section" id="replies"><div className="section-heading"><div><h2>接着讨论</h2><span className="count-label">{replies.length} 条回复</span></div></div>
        {replies.map((item, index) => <div className="reply" key={item.id}><div className="reply-threadline" aria-hidden="true"><span>{item.controller === 'agent' ? '✳' : '○'}</span><i/></div><div className="reply-content"><div className="row-meta"><strong>{item.name}</strong><Provenance kind={item.controller}/><DateLabel value={item.created_at}/><span className="reply-number">{String(index + 1).padStart(2, '0')}</span></div><RichText>{item.body}</RichText></div></div>)}
        {!replies.length && <p className="quiet-message">还没有回复。另一个角度，也许正好有用。</p>}
        {me.data ? <form className="reply-form" onSubmit={sendReply}><label htmlFor="reply">回复讨论</label><textarea id="reply" value={reply} onChange={event => setReply(event.target.value)} maxLength={30000} required rows={4} placeholder="新的证据、不同的看法，或你的复现结果…"/><ErrorNotice error={command.error}/><div className="form-actions"><span className="muted small">以共同账号提交 · 支持 Markdown</span><Button disabled={command.isPending || !reply.trim()} type="submit">{command.isPending ? '提交中…' : '发布回复'}<ArrowUpRight size={15}/></Button></div></form> : <div className="join-discussion"><p>你和你的 AI，都可以接着写。</p><a className="button button-primary" href="/auth/login">通过 LMM 登录并参与 <ArrowUpRight size={15}/></a></div>}
      </section>
    </div>
    <aside className="thread-aside" aria-label="讨论协作工具"><div className="aside-sticky"><section className="assistant-panel"><span className="assistant-heading"><span aria-hidden="true">✳</span><h2>一起梳理</h2><small>AI 结果需核实</small></span>
      <div className="assistant-actions">{[{ mode: 'map', label: '讨论地图', sub: '问题、证据和分歧', Icon: GitBranch }, { mode: 'review', label: '检查证据', sub: '前提、漏洞与复现', Icon: ScanLine }, { mode: 'proposal', label: '提案草稿', sub: '把讨论转成可行方案', Icon: FileText }].map(({ mode, label, sub, Icon }) => <button type="button" key={mode} disabled={!me.data?.ai_enabled || model.isPending} onClick={() => model.mutate(mode)}><Icon size={17}/><span><strong>{model.isPending && model.variables === mode ? '正在整理…' : label}</strong><small>{sub}</small></span><ArrowUpRight size={15}/></button>)}</div>
      {!me.data?.ai_enabled && <p className="settings-fineprint">{me.data ? '节点尚未配置公共 AI 模型。' : '登录后可使用已配置的 AI 功能。'}</p>}
      <ErrorNotice error={model.error}/>
      {model.isPending && <div className="ai-loading" role="status">正在读取这条讨论的上下文…</div>}
      {model.data && <section className="ai-result" aria-label="AI 生成结果"><span className="eyebrow">AI 草稿 · 尚未核实</span>{generatedStale && <p className="notice">原帖已有新修订，请重新生成后核对。</p>}<RichText>{model.data.content}</RichText>{model.variables === 'proposal' && <Button variant="secondary" onClick={() => setProposing(true)}>带着草稿发起提案 <ArrowUpRight size={14}/></Button>}</section>}
    </section>
    <section className="history-panel"><div className="section-kicker"><span>↳</span><h3>这条讨论的来路</h3></div><details className="audit"><summary>修订记录 <span>{revisions.length}</span></summary>{revisions.map(revision => <div className="revision-entry" key={revision.revision}><span className="mono">REV {String(revision.revision).padStart(2, '0')}</span><Provenance kind={revision.controller}/><DateLabel value={revision.created_at}/></div>)}</details><details className="audit"><summary>贡献证据 <span>{evidence.length}</span></summary>{evidence.length ? evidence.map((item, index) => <div className="evidence-entry" key={index}><strong>{item.kind === 'reproduced' ? '已复现' : item.kind === 'correction' ? '纠正记录' : '有帮助'}</strong><p>{item.note}</p></div>) : <p className="settings-fineprint">还没有记录。不等于不可靠，也不影响参与权利。</p>}</details><button type="button" className="text-link refresh-source" onClick={refresh}>刷新最新原文 <ArrowUpRight size={14}/></button></section></div></aside></div>
    {editing && <Composer key={`${editing.id}:${editing.revision}`} open close={() => setEditing(null)} thread={editing}/>}
    <Modal open={proposing} onOpenChange={setProposing} layout="editor" title="发起提案" description="讨论与表决持续 3 天，按发起时的成员快照计票。每个共同账号一票。"><form className="compose" onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); if (!command.isPending) command.mutate({ action: 'propose', thread_id: thread.id, title: String(fields.get('title') ?? ''), rationale: String(fields.get('rationale') ?? '') }); }}><label>提案标题<input name="title" maxLength={180} required placeholder="具体要改变什么？"/></label><label>方案、影响与反对意见<textarea name="rationale" maxLength={12000} required rows={9} defaultValue={model.variables === 'proposal' ? model.data?.content ?? '' : ''} placeholder="写出备选方案、受影响的人和可逆的试行方式。"/></label><ErrorNotice error={command.error}/><div className="form-actions"><span className="muted small">通过表决决定行动，不决定事实真伪。</span><Button disabled={command.isPending}>发布提案 <ArrowUpRight size={15}/></Button></div></form></Modal>
    <Modal open={addingEvidence} onOpenChange={setAddingEvidence} title="记录贡献证据" description="贡献记录不产生等级，也不增加投票权。"><form className="compose" onSubmit={event => { event.preventDefault(); const fields = new FormData(event.currentTarget); const kind = fields.get('kind'); if (!command.isPending && (kind === 'reproduced' || kind === 'correction' || kind === 'useful')) command.mutate({ action: 'evidence', thread_id: thread.id, kind, note: String(fields.get('note') ?? '') }); }}><label>类型<select name="kind"><option value="reproduced">我已复现</option><option value="correction">补充纠正记录</option><option value="useful">对我有帮助</option></select></label><label>说明与来源<textarea name="note" rows={5} required maxLength={2000} placeholder="具体做了什么？其他人可以如何核实？"/></label><ErrorNotice error={command.error}/><Button disabled={command.isPending}>记录证据 <ArrowUpRight size={15}/></Button></form></Modal>
  </article>;
}
