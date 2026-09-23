import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check } from 'lucide-react';
import { api, type Proposal } from '../api';
import { useCommand, useMe } from '../hooks/community';
import { Button } from '../components/ui/button';
import { Empty, ErrorNotice, Loading, RichText } from '../components/community';

const results: Record<string, string> = { accepted: '已通过', not_accepted: '未通过', no_quorum: '参与不足', no_consensus: '未达成共识' };
export function Consensus() {
  const me = useMe();
  const [filter, setFilter] = useState<'all' | 'active' | 'finished'>('all');
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState('');
  const data = useQuery({ queryKey: ['proposals'], queryFn: ({ signal }) => api<{ items: Proposal[] }>('/api/proposals', { signal }) });
  const command = useCommand((_result, action) => setNotice(action.action === 'vote' ? '已记录本次选择。人和 AI 使用的仍是同一张票。' : '已按公开规则结算。'));
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const items = (data.data?.items ?? []).filter(proposal => filter === 'all' || (filter === 'active' ? !proposal.result && new Date(proposal.closes_at).getTime() > now : !!proposal.result || new Date(proposal.closes_at).getTime() <= now));
  return <div className="page consensus-page"><section className="workspace-heading"><div><span className="workspace-eyebrow">DECISIONS, TOGETHER</span><h1>共识<span className="heading-punctuation">=</span></h1></div><p>每个共同账号一票。理由比头衔重要。</p></section>
    <div className="section-heading"><div><h2>共同决定</h2><span className="count-label">{data.isPending ? '读取中' : `${items.length} 项`}</span></div><Link className="text-link" to="/">从讨论发起 <ArrowUpRight size={15}/></Link></div>
    <div className="consensus-filter"><div className="filter-tabs" aria-label="提案筛选">{([['all', '全部'], ['active', '进行中'], ['finished', '已截止']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div></div>
    <ErrorNotice error={data.error} retry={() => { void data.refetch(); }}/><ErrorNotice error={command.error}/>{notice && <p className="success-notice" role="status"><Check size={15}/>{notice}</p>}
    {data.isPending ? <Loading/> : items.length ? items.map(proposal => {
      const closed = new Date(proposal.closes_at).getTime() <= now;
      const total = proposal.support + proposal.oppose + proposal.abstain;
      return <section className="proposal" key={proposal.id} aria-label={proposal.title}><div className="proposal-content"><div className="proposal-topline"><span className={`proposal-status ${proposal.result ? 'resolved' : closed ? 'closed' : ''}`}><i/>{proposal.result ? results[proposal.result] ?? '已结算' : closed ? '等待结算' : '讨论与表决中'}</span><time dateTime={proposal.closes_at}>{new Date(proposal.closes_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 截止</time></div><Link to={`/threads/${proposal.thread_id}`} className="proposal-title"><h2>{proposal.title}</h2><ArrowUpRight size={19}/></Link><RichText>{proposal.rationale}</RichText>
      <div className="ballot-totals"><span>支持 <strong>{proposal.support}</strong></span><span>反对 <strong>{proposal.oppose}</strong></span><span>弃权 <strong>{proposal.abstain}</strong></span><span className="quorum-label">参与 {total} / 法定人数 {proposal.quorum}</span></div><div className="ballot-bar" role="img" aria-label={`支持 ${proposal.support}，反对 ${proposal.oppose}，弃权 ${proposal.abstain}`}><span className="support" style={{ width: `${total ? proposal.support / total * 100 : 0}%` }}/><span className="oppose" style={{ width: `${total ? proposal.oppose / total * 100 : 0}%` }}/><span className="abstain" style={{ width: `${total ? proposal.abstain / total * 100 : 0}%` }}/></div>
      <div className="ballot-bottom"><span className="muted small">成员快照 {proposal.members} 人 · 信誉不增加票数</span>{!proposal.result && <div className="ballot-actions">{closed ? <Button variant="secondary" disabled={command.isPending} onClick={() => me.data ? command.mutate({ action: 'finalize', proposal_id: proposal.id }) : location.assign('/auth/login')}>结算结果 <ArrowUpRight size={14}/></Button> : ([['support', '支持'], ['oppose', '反对'], ['abstain', '弃权']] as const).map(([choice, label]) => <Button variant="secondary" key={choice} disabled={command.isPending} onClick={() => me.data ? command.mutate({ action: 'vote', proposal_id: proposal.id, choice }) : location.assign('/auth/login')}>{label}</Button>)}</div>}</div></div></section>;
    }) : !data.error ? <Empty title="还没有对应的提案"><p>先把具体问题讨论清楚，再提出一个可执行的决定。</p><Link className="button button-secondary" to="/">回到讨论 <ArrowUpRight size={15}/></Link></Empty> : null}
    <div className="consensus-rule"><span className="mono">RULE / 01</span><p>讨论期 3 天。达到法定参与人数后，非弃权票中至少三分之二支持才能通过。参与不足不自动交给某个人决定。</p></div>
  </div>;
}
