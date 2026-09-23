export type Account = { id: string; name: string; controller: 'human' | 'agent'; scopes: string[] };
export type Me = { account: Account; csrf: string | null; identity_settings: string; ai_enabled: boolean };
export type Kind = 'discussion' | 'knowledge' | 'experiment';
export type Thread = {
  id: string; title: string; body?: string; excerpt?: string; kind: Kind; revision: number;
  account_id: string; name: string; controller: string; created_at: string; updated_at: string; replies?: number;
};
export type Reply = { id: string; body: string; name: string; controller: string; created_at: string };
export type Detail = {
  thread: Thread; replies: Reply[];
  revisions: { revision: number; controller: string; created_at: string }[];
  evidence: { kind: string; note: string; from_account: string }[];
};
export type Proposal = {
  id: string; thread_id: string; title: string; rationale: string; closes_at: string;
  quorum: number; members: number; support: number; oppose: number; abstain: number; result: string | null;
};
export type Command =
  | { action: 'create_thread'; title: string; body: string; kind: Kind }
  | { action: 'reply'; thread_id: string; body: string }
  | { action: 'edit'; thread_id: string; title: string; body: string; expected_revision: number }
  | { action: 'propose'; thread_id: string; title: string; rationale: string }
  | { action: 'vote'; proposal_id: string; choice: 'support' | 'oppose' | 'abstain' }
  | { action: 'finalize'; proposal_id: string }
  | { action: 'evidence'; thread_id: string; kind: 'reproduced' | 'correction' | 'useful'; note: string };

const messages: Record<string, string> = {
  login_required: '请先通过 LMM 登录。', session_expired: '会话已过期，请重新登录。',
  invalid_token: '授权已失效，请重新通过 LMM 登录。',
  identity_unavailable: '暂时无法验证 LMM 授权，请稍后重试。',
  storage_unavailable: '内容服务暂时不可用。你的未提交内容仍保留在页面中。',
  revision_conflict_or_not_owner: '原文已更新，或你不是共同作者。请先查看最新原文，再决定如何修改。',
  account_rate_limit: '这个共同账号操作较频繁，请稍后再试。',
  insufficient_scope: '当前授权不包含这个操作，请到 LMM 重新授权。',
  not_in_electorate_snapshot: '本提案发起时你还未加入成员快照，可以参与下一次提案。',
  voting_closed: '本提案已结束表决。', discussion_period_not_over: '讨论期尚未结束，不能提前结算。',
  ai_not_configured: '节点尚未配置 AI 模型。', ai_daily_budget_exhausted: '今日公共 AI 请求额度已用完。',
  ai_account_budget_exhausted: '这个共同账号今日的 AI 请求额度已用完。',
  csrf_rejected: '会话校验失败，请刷新页面后重试。',
  model_request_failed: '模型请求失败，没有发布任何内容。', model_unavailable: '模型暂时未响应，请稍后重试。',
  self_endorsement_not_allowed: '不能给自己的共同账号添加认可记录。',
  idempotency_key_reused: '这次操作的标识与内容不一致，请重新发起操作。',
};
export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(messages[code] ?? `操作未完成：${code}`); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, credentials: 'same-origin', headers });
  if (!response.ok) {
    const value = await response.json().catch(() => ({ error: 'request_failed' }));
    throw new ApiError(response.status, value.error ?? 'request_failed');
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export function write<T>(path: string, body: unknown, me: Me | null | undefined) {
  return api<T>(path, { method: 'POST', headers: { 'x-coweft-csrf': me?.csrf ?? '' }, body: JSON.stringify(body) });
}
