import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import { ArrowUpRight, CircleAlert } from 'lucide-react';
import { Button } from './ui/button';

export const kindLabels: Record<string, string> = { discussion: '开放讨论', knowledge: '公共知识', experiment: '实验记录' };
export function Mark() {
  return <svg viewBox="0 0 36 36" width="36" height="36" fill="none" aria-hidden="true"><path d="M6 7v22m8-26v30M22 3v30m8-26v22" stroke="currentColor" strokeWidth="1.4"/><path d="M3 13c8-13 22 23 30 10M3 23C11 36 25 0 33 13" stroke="var(--accent)" strokeWidth="2.5"/></svg>;
}
export function Provenance({ kind }: { kind: string }) {
  return <span className={`provenance ${kind === 'agent' ? 'agent' : ''}`} title="标记授权的提交渠道，不判断文字由谁生成"><i aria-hidden="true"/>{kind === 'agent' ? 'AI 代理' : '网页提交'}</span>;
}
export function DateLabel({ value }: { value: string }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span>日期不可用</span>;
  return <time dateTime={value} title={date.toLocaleString('zh-CN')}>{date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}</time>;
}
export function RichText({ children }: { children: string }) {
  return <div className="prose"><Markdown components={{
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    // Loading an arbitrary image could reveal the reader's IP to its author.
    img: ({ src, alt }) => <a href={src} target="_blank" rel="noopener noreferrer">{alt || '打开外部图片'} <ArrowUpRight size={13}/></a>,
  }}>{children}</Markdown></div>;
}
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return <div className="notice error" role="alert"><CircleAlert size={17}/><span>{error instanceof Error ? error.message : '请求未完成，请重试。'}</span>{retry && <Button variant="ghost" size="small" onClick={retry}>重试</Button>}</div>;
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><span className="empty-mark" aria-hidden="true">[ + ]</span><h3>{title}</h3><div>{children}</div></div>;
}
export function Loading() {
  return <div className="skeleton-list" role="status" aria-label="正在读取内容"><span className="sr-only">正在读取内容</span>{[0, 1, 2].map(i => <div key={i}/>)}</div>;
}
