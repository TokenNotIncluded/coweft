import type { ReactNode } from 'react';
import Markdown from 'react-markdown';
import { ArrowUpRight, CircleAlert } from 'lucide-react';
import { Button } from './ui/button';

export const kindLabels: Record<string, string> = { discussion: '开放讨论', knowledge: '公共知识', experiment: '实验记录' };
export function Mark() {
  return <svg viewBox="0 0 36 36" width="36" height="36" fill="none" aria-hidden="true"><path d="M18 10a9 9 0 1 0 0 16m0-16a9 9 0 1 1 0 16" stroke="currentColor" strokeWidth="2"/><path d="M18 10c-5 5-5 11 0 16 5-5 5-11 0-16Z" fill="currentColor"/></svg>;
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
