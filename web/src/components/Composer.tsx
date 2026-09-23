import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Columns2, Eye, PenLine } from 'lucide-react';
import { type Kind, type Thread } from '../api';
import { useCommand, useMe } from '../hooks/community';
import { Button } from './ui/button';
import { Modal } from './ui/dialog';
import { ErrorNotice, RichText } from './community';

export function Composer({ open, close, initialKind = 'discussion', thread, initialTitle = '', onPublished }: {
  open: boolean; close: () => void; initialKind?: Kind; thread?: Thread; initialTitle?: string; onPublished?: () => void;
}) {
  const me = useMe();
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState(thread?.title ?? initialTitle);
  const [body, setBody] = useState(thread?.body ?? '');
  const [kind, setKind] = useState<Kind>(thread?.kind ?? initialKind);
  const [view, setView] = useState<'write' | 'preview' | 'split'>('write');
  const [discard, setDiscard] = useState(false);
  const mutation = useCommand(result => {
    if (!thread) { setTitle(''); setBody(''); setView('write'); onPublished?.(); }
    close();
    if (result.id) navigate(`/threads/${result.id}`);
  });
  const dirty = title !== (thread?.title ?? '') || body !== (thread?.body ?? '');
  const requestClose = () => {
    if (mutation.isPending) return;
    if (dirty) setDiscard(true); else close();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mutation.isPending || !title.trim() || !body.trim()) return;
    mutation.mutate(thread ? { action: 'edit', thread_id: thread.id, title, body, expected_revision: thread.revision } : { action: 'create_thread', title, body, kind });
  };
  return <>
    <Modal open={open} onOpenChange={value => { if (!value) requestClose(); }} layout="editor" title={thread ? '编辑讨论' : '新讨论'} description={thread ? `基于修订 ${thread.revision}。原文更新时会阻止覆盖，你的修改仍会保留。` : '以你的共同账号发布。支持 Markdown。'}>
      <form ref={form} className="composer" onSubmit={submit} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); form.current?.requestSubmit(); } }}>
        <div className="composer-meta"><span className="mono">{thread ? 'EDIT / 修订' : 'NEW THREAD / 新线索'}</span><span>{me.data?.account.name ?? '通过 LMM 登录'}</span></div>
        <label className="title-field"><span className="sr-only">标题</span><input name="title" value={title} onChange={event => setTitle(event.target.value)} maxLength={180} required autoComplete="off" placeholder="你正在解决什么问题？"/></label>
        {!thread && <fieldset className="kind-picker"><legend className="sr-only">内容类型</legend>{([['discussion', '讨论'], ['experiment', '实验记录'], ['knowledge', '公共知识']] as const).map(([value, label]) => <label key={value}><input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)}/><span>{label}</span></label>)}</fieldset>}
        <div className="editor-toolbar"><label htmlFor="body-editor">正文 <span className="mono">/ MARKDOWN</span></label><div aria-label="编辑视图"><button type="button" aria-label="编辑正文" aria-pressed={view === 'write'} onClick={() => setView('write')}><PenLine size={15}/><span>编辑</span></button><button type="button" aria-label="预览正文" aria-pressed={view === 'preview'} onClick={() => setView('preview')}><Eye size={15}/><span>预览</span></button><button type="button" className="split-control" aria-label="分栏预览" aria-pressed={view === 'split'} onClick={() => setView('split')}><Columns2 size={15}/></button></div></div>
        <div className={`editor-workspace editor-${view}`}>
          {view !== 'preview' && <textarea id="body-editor" name="body" value={body} onChange={event => setBody(event.target.value)} rows={11} maxLength={60000} placeholder="背景是什么？\n已经尝试了什么？\n哪些证据值得一起看看？"/>}
          {view !== 'write' && <section className="editor-preview" aria-label="正文预览">{body ? <RichText>{body}</RichText> : <p className="muted">写下第一句，这里会呈现排版后的内容。</p>}</section>}
        </div>
        {thread && <details className="original-text"><summary>查看本次编辑的原文</summary><RichText>{thread.body ?? ''}</RichText></details>}
        <ErrorNotice error={mutation.error}/>
        <div className="composer-footer"><div><span>{Array.from(body).length.toLocaleString()} 字符</span><small>仅保留在当前页面，尚未发布。</small></div><div><span className="keyboard-hint">⌘ / Ctrl + Enter</span><Button type="submit" disabled={mutation.isPending || !body.trim() || !title.trim()}>{mutation.isPending ? '提交中…' : thread ? '保存修订' : '发布讨论'}<ArrowUpRight size={16}/></Button></div></div>
      </form>
    </Modal>
    <Modal open={discard} onOpenChange={setDiscard} title="保留未提交的内容？" description="关闭不会发布内容。可以回去继续编辑，或明确放弃这次修改。"><div className="confirm-actions"><Button variant="secondary" onClick={() => setDiscard(false)}>继续编辑</Button><Button variant="danger" onClick={() => { setDiscard(false); setTitle(thread?.title ?? ''); setBody(thread?.body ?? ''); mutation.reset(); close(); }}>放弃修改</Button></div></Modal>
  </>;
}
