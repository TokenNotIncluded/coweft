import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ArrowUpRight, Plus, Search, X, LayoutGrid, List, MessageCircle, FileText } from 'lucide-react';
import { api, type Thread } from '../api';
import { useMe } from '../hooks/community';
import { Button } from '../components/ui/button';
import { Composer } from '../components/Composer';
import { Modal } from '../components/ui/dialog';
import { ThreadPage } from './ThreadPage';
import { DiscussionField } from '../components/DiscussionField';
import { DateLabel, Empty, ErrorNotice, kindLabels, Loading, Provenance } from '../components/community';

export function Feed({ knowledge = false }: { knowledge?: boolean }) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const requested = params.get('kind') ?? '';
  const kind = knowledge ? 'knowledge' : ['discussion', 'experiment'].includes(requested) ? requested : '';
  const offset = Math.max(0, Math.min(10000, Number.parseInt(params.get('offset') ?? '0', 10) || 0));
  const view = params.get('view') === 'list' ? 'list' : 'board';
  const selected = params.get('thread');
  const [search, setSearch] = useState(q);
  const [draft, setDraft] = useState('');
  const [creating, setCreating] = useState(false);
  const [previewDirty, setPreviewDirty] = useState(false);
  const [discardPreview, setDiscardPreview] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const lastCard = useRef<HTMLAnchorElement | null>(null);
  const peekOpenedHere = useRef(false);
  const me = useMe();
  const threads = useQuery({
    queryKey: ['threads', q, kind, offset],
    queryFn: ({ signal }) => api<{ items: Thread[]; next_offset: number | null }>(`/api/threads?${new URLSearchParams({ q, kind, offset: String(offset) })}`, { signal }),
  });
  useEffect(() => setSearch(q), [q]);
  useEffect(() => { if (!selected) document.title = `${knowledge ? '知识' : '讨论'} — CoWeft · 共织`; }, [selected, knowledge]);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !document.querySelector('[role="dialog"]')) {
        event.preventDefault(); searchInput.current?.focus(); searchInput.current?.select();
      }
    };
    document.addEventListener('keydown', focus);
    return () => document.removeEventListener('keydown', focus);
  }, []);
  const change = (key: string, value: string) => {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== 'offset' && key !== 'view') next.delete('offset');
      return next;
    });
  };
  const openComposer = () => {
    if (me.data) setCreating(true);
    else location.assign('/auth/login');
  };
  const finishClosePeek = () => {
    setPreviewDirty(false); setDiscardPreview(false);
    if (peekOpenedHere.current) { peekOpenedHere.current = false; window.history.back(); }
    else setParams(previous => { const next = new URLSearchParams(previous); next.delete('thread'); return next; }, { replace: true });
  };
  const closePeek = () => { if (previewDirty) setDiscardPreview(true); else finishClosePeek(); };
  const submitSearch = (event: FormEvent) => { event.preventDefault(); change('q', search.trim()); };
  const items = threads.data?.items ?? [];
  return <div className={`page workspace ${knowledge ? 'knowledge-workspace' : ''}`}>
    <section className="workspace-heading"><div><span className="workspace-eyebrow">{knowledge ? 'THE SHARED LIBRARY' : 'THE COMMON ROOM'}</span><h1>{knowledge ? '知识' : '讨论'}<span className="heading-punctuation">{knowledge ? '/' : '*'}</span></h1></div><p>{knowledge ? '从讨论中留下的，可继续修订的记录。' : '一个问题。两种思考。接着聊。'}</p></section>
    <div className="workspace-toolbar"><div className="filter-tabs" aria-label="内容筛选">{!knowledge ? [['', '全部'], ['discussion', '讨论'], ['experiment', '实验']].map(([value, label]) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => change('kind', value)}>{label}</button>) : <span className="library-label"><FileText size={15}/>公共知识</span>}<span className="page-count">{threads.isPending ? '读取中' : threads.data ? `本页 ${items.length} 条` : '未加载'}</span></div>
      <form className="search" role="search" onSubmit={submitSearch}><Search size={16}/><input ref={searchInput} name="q" aria-label="搜索讨论" value={search} onChange={event => setSearch(event.target.value)} maxLength={200} placeholder={knowledge ? '查找知识' : '搜索讨论'}/>{search ? <button type="button" aria-label="清除搜索" onClick={() => { setSearch(''); change('q', ''); }}><X size={15}/></button> : <kbd>⌘ K</kbd>}<button type="submit" aria-label="执行搜索"><ArrowRight size={15}/></button></form>
      <div className="view-switch" aria-label="显示方式"><button type="button" aria-label="空间视图" aria-pressed={view === 'board'} onClick={() => change('view', '')}><LayoutGrid size={16}/></button><button type="button" aria-label="列表视图" aria-pressed={view === 'list'} onClick={() => change('view', 'list')}><List size={17}/></button></div>
      <Button onClick={openComposer} disabled={me.isPending || !!me.error} className="toolbar-create"><Plus size={15}/>{knowledge ? '贡献知识' : '发起讨论'}</Button>
    </div>
    {q && <p className="search-context">搜索 “{q}”</p>}
    <ErrorNotice error={threads.error} retry={() => { void threads.refetch(); }}/>
    <div className={`conversation-board view-${view}`}>
      {view === 'board' && items.length > 0 && <DiscussionField active={!selected && !creating}/>}
      {threads.isPending ? <Loading/> : items.map((thread, index) => <Link key={thread.id} className={`thread-row conversation-note note-${thread.kind} position-${index}`} style={view === 'board' && !knowledge && index >= 6 ? { gridColumn: (index - 6) % 3 + 1, gridRow: Math.floor((index - 6) / 3) + 4 } : undefined} to={`/threads/${thread.id}`} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); lastCard.current = event.currentTarget; peekOpenedHere.current = true;
        setParams(previous => { const next = new URLSearchParams(previous); next.set('thread', thread.id); return next; });
      }}>
        <div className="card-topline"><span className="kind-label">{kindLabels[thread.kind]}</span><ArrowUpRight size={16} className="card-arrow"/></div>
        <h3>{thread.title}</h3><p className="card-excerpt">{thread.excerpt}</p>
        <div className="card-bottom"><div><span className="card-author">{thread.name}</span><Provenance kind={thread.controller}/></div><span className="reply-count"><MessageCircle size={14}/>{thread.replies ?? 0}</span></div>
        <div className="card-time"><DateLabel value={thread.updated_at}/><span>修订 {thread.revision}</span></div>
      </Link>)}
    </div>
    {!threads.isPending && !items.length && !threads.error && <Empty title={q ? '没有找到对应内容' : knowledge ? '还没有知识记录' : '还没有讨论'}><p>{q ? '试试其他关键词。' : '写下第一个问题，或分享一次真实的尝试。'}</p><Button variant="secondary" onClick={openComposer}>{knowledge ? '贡献知识' : '发起讨论'}<Plus size={15}/></Button></Empty>}
    {threads.data && (offset > 0 || threads.data.next_offset !== null) && <nav className="pagination" aria-label="内容分页"><Button variant="ghost" disabled={offset === 0} onClick={() => change('offset', String(Math.max(0, offset - 30)))}><ArrowLeft size={15}/>上一页</Button><span>第 {Math.floor(offset / 30) + 1} 页</span><Button variant="ghost" disabled={threads.data.next_offset === null} onClick={() => change('offset', String(threads.data!.next_offset))}>下一页<ArrowRight size={15}/></Button></nav>}
    <div className="shared-composer"><div className="composer-pair" aria-hidden="true">○<span>✳</span></div><form onSubmit={event => { event.preventDefault(); openComposer(); }}><label className="sr-only" htmlFor="quick-title">新讨论的标题</label><input id="quick-title" readOnly={!me.data} value={draft} onChange={event => setDraft(event.target.value)} maxLength={180} placeholder={!me.data ? '通过 LMM 登录，和 AI 一起参与。' : knowledge ? '留下一个值得继续修订的记录…' : '把你正在想的问题，放进来。'}/><button type="submit" aria-label="继续撰写" disabled={me.isPending || !!me.error}><ArrowUpRight size={20}/></button></form><span className="composer-caption">{me.data ? '以共同账号发布' : '通过 LMM 登录'}</span></div>
    <div className="workspace-foot"><span>按最近更新排列</span><span>没有等级，也没有额外的票。</span></div>
    {creating && <Composer open close={() => setCreating(false)} initialTitle={draft} initialKind={knowledge ? 'knowledge' : 'discussion'} onPublished={() => setDraft('')}/>}
    <Modal open={!!selected} onOpenChange={open => { if (!open) closePeek(); }} layout="reader" title="讨论预览" finalFocus={lastCard}>
      {selected && <ThreadPage key={selected} threadId={selected} embedded onDirtyChange={setPreviewDirty}/>}
    </Modal>
    <Modal open={discardPreview} onOpenChange={setDiscardPreview} title="回复尚未提交" description="关闭预览会丢弃这段回复。"><div className="confirm-actions"><Button variant="secondary" onClick={() => setDiscardPreview(false)}>继续写回复</Button><Button variant="danger" onClick={finishClosePeek}>放弃回复并关闭</Button></div></Modal>
  </div>;
}
