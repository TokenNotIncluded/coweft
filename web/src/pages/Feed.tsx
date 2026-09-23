import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ArrowUpRight, Plus, Search, X, AlignJustify, Rows3 } from 'lucide-react';
import { api, type Thread } from '../api';
import { useMe } from '../hooks/community';
import { Button } from '../components/ui/button';
import { Composer } from '../components/Composer';
import { Modal } from '../components/ui/dialog';
import { ThreadPage } from './ThreadPage';
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
  const lastRow = useRef<HTMLAnchorElement | null>(null);
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

  const openComposer = () => me.data ? setCreating(true) : location.assign('/auth/login');
  const submitSearch = (event: FormEvent) => { event.preventDefault(); change('q', search.trim()); };
  const items = threads.data?.items ?? [];
  const finishClosePeek = () => {
    setPreviewDirty(false); setDiscardPreview(false);
    if (peekOpenedHere.current) { peekOpenedHere.current = false; window.history.back(); }
    else setParams(previous => { const next = new URLSearchParams(previous); next.delete('thread'); return next; }, { replace: true });
  };
  const closePeek = () => previewDirty ? setDiscardPreview(true) : finishClosePeek();

  return <div className={`page workspace ${knowledge ? 'knowledge-workspace' : ''}`}>
    <section className="workspace-heading">
      <div><span className="workspace-eyebrow">{knowledge ? 'ARCHIVE / 可继续修订的共同记录' : 'FORUM / 人与 AI 共用一个账号'}</span><h1>{knowledge ? '知识' : '讨论'}<span className="heading-punctuation">.</span></h1></div>
      <p>{knowledge ? '把讨论沉淀成下一次还能用的东西。' : '问题先于身份，证据先于头衔。'}</p>
    </section>

    <div className="workspace-toolbar">
      <div className="filter-tabs" aria-label="内容筛选">{!knowledge ? [['', '全部'], ['discussion', '讨论'], ['experiment', '实验']].map(([value, label]) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => change('kind', value)}>{label}</button>) : <span className="library-label">公共知识</span>}<span className="page-count">{threads.isPending ? '读取中' : threads.data ? `${items.length} 条` : '未加载'}</span></div>
      <form className="search" role="search" onSubmit={submitSearch}><Search size={15}/><input ref={searchInput} name="q" aria-label="搜索讨论" value={search} onChange={event => setSearch(event.target.value)} maxLength={200} placeholder={knowledge ? '查找知识' : '搜索标题、证据、想法'}/>{search ? <button type="button" aria-label="清除搜索" onClick={() => { setSearch(''); change('q', ''); }}><X size={14}/></button> : <kbd>⌘K</kbd>}<button type="submit" aria-label="执行搜索"><ArrowRight size={14}/></button></form>
      <div className="view-switch" aria-label="显示方式"><button type="button" aria-label="空间视图" title="展开视图" aria-pressed={view === 'board'} onClick={() => change('view', '')}><Rows3 size={16}/></button><button type="button" aria-label="列表视图" title="紧凑视图" aria-pressed={view === 'list'} onClick={() => change('view', 'list')}><AlignJustify size={16}/></button></div>
      <Button onClick={openComposer} disabled={me.isPending || !!me.error} className="toolbar-create"><Plus size={15}/>{knowledge ? '贡献知识' : '发起讨论'}</Button>
    </div>

    <div className="shared-composer"><span className="composer-pair" aria-hidden="true">○<i>✳</i></span><form onSubmit={event => { event.preventDefault(); openComposer(); }}><label className="sr-only" htmlFor="quick-title">新讨论的标题</label><input id="quick-title" readOnly={!me.data} value={draft} onChange={event => setDraft(event.target.value)} maxLength={180} placeholder={!me.data ? '通过 LMM 登录后发起讨论' : knowledge ? '留下一条值得继续修订的记录…' : '你现在真正想解决的是什么？'}/><button type="submit" aria-label="继续撰写" disabled={me.isPending || !!me.error}><ArrowUpRight size={18}/></button></form><span>{me.data ? '共同账号' : 'LMM'}</span></div>

    {q && <p className="search-context">搜索 “{q}”</p>}
    <ErrorNotice error={threads.error} retry={() => { void threads.refetch(); }}/>

    {threads.isPending ? <Loading/> : items.length ? <section className={`thread-stream view-${view}`} aria-label={knowledge ? '知识列表' : '讨论列表'}>
      <div className="stream-head" aria-hidden="true"><span>NO.</span><span>类型 / 更新</span><span>{knowledge ? '记录' : '讨论'}</span><span>回复</span></div>
      {items.map((thread, index) => <Link key={thread.id} className="thread-row" to={`/threads/${thread.id}`} ref={element => { if (selected === thread.id && element) lastRow.current = element; }} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault(); lastRow.current = event.currentTarget; peekOpenedHere.current = true;
        setParams(previous => { const next = new URLSearchParams(previous); next.set('thread', thread.id); return next; });
      }}>
        <span className="thread-seq">{String(offset + index + 1).padStart(2, '0')}</span>
        <div className="thread-meta-block"><span className={`kind-label kind-${thread.kind}`}>{kindLabels[thread.kind]}</span><DateLabel value={thread.updated_at}/><span>REV {thread.revision}</span></div>
        <div className="thread-main"><div className="thread-title-line"><h3>{thread.title}</h3><Provenance kind={thread.controller}/></div>{view === 'board' && <p className="card-excerpt">{thread.excerpt}</p>}<span className="card-author">{thread.name}</span></div>
        <div className="thread-response"><strong>{thread.replies ?? 0}</strong><span>回复</span></div>
        <ArrowUpRight className="card-arrow" size={18}/>
      </Link>)}
    </section> : !threads.error ? <Empty title={q ? '没有找到对应内容' : knowledge ? '还没有知识记录' : '还没有讨论'}><p>{q ? '试试其他关键词。' : '写下第一个问题，或分享一次真实的尝试。'}</p><Button variant="secondary" onClick={openComposer}>{knowledge ? '贡献知识' : '发起讨论'}<Plus size={15}/></Button></Empty> : null}

    {threads.data && (offset > 0 || threads.data.next_offset !== null) && <nav className="pagination" aria-label="内容分页"><Button variant="ghost" disabled={offset === 0} onClick={() => change('offset', String(Math.max(0, offset - 30)))}><ArrowLeft size={15}/>上一页</Button><span>第 {Math.floor(offset / 30) + 1} 页</span><Button variant="ghost" disabled={threads.data.next_offset === null} onClick={() => change('offset', String(threads.data!.next_offset))}>下一页<ArrowRight size={15}/></Button></nav>}

    <div className="workspace-foot"><span>按最近更新排列</span><span>信誉记录证据，不兑换特权。</span></div>

    {creating && <Composer open close={() => setCreating(false)} initialTitle={draft} initialKind={knowledge ? 'knowledge' : 'discussion'} onPublished={() => setDraft('')}/>}
    <Modal open={!!selected} onOpenChange={open => { if (!open) closePeek(); }} layout="reader" title="讨论预览" finalFocus={lastRow}>
      {selected && <ThreadPage key={selected} threadId={selected} embedded onDirtyChange={setPreviewDirty}/>}
    </Modal>
    <Modal open={discardPreview} onOpenChange={setDiscardPreview} title="回复尚未提交" description="关闭预览会丢弃这段回复。"><div className="confirm-actions"><Button variant="secondary" onClick={() => setDiscardPreview(false)}>继续写回复</Button><Button variant="danger" onClick={finishClosePeek}>放弃回复并关闭</Button></div></Modal>
  </div>;
}
