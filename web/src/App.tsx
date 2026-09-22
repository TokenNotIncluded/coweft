import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowUpRight, ArrowRight, SlidersHorizontal } from 'lucide-react';
import { Button } from './components/ui/button';
import { Mark, Empty, ErrorNotice } from './components/community';
import { Settings } from './components/Settings';
import { Feed } from './pages/Feed';
import { ThreadPage } from './pages/ThreadPage';
import { Consensus } from './pages/Consensus';
import { useMe } from './hooks/community';

function RouteEffects() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.title = `${pathname === '/knowledge' ? '知识' : pathname === '/consensus' ? '共识' : '讨论'} — CoWeft · 共织`;
  }, [pathname]);
  return null;
}
export default function App() {
  const [settings, setSettings] = useState(false);
  const me = useMe();
  return <>
    <RouteEffects/>
    <a className="skip-link" href="#main">跳转到内容</a>
    <header className="site-header"><div className="header-inner">
      <Link className="brand" to="/" aria-label="共织首页"><Mark/><span>CoWeft<span className="brand-slash">/</span><small>共织</small></span></Link>
      <nav aria-label="主要导航">{[['/', '讨论', '01'], ['/knowledge', '知识', '02'], ['/consensus', '共识', '03']].map(([path, label, index]) => <NavLink key={path} to={path} end><small aria-hidden="true">{index}</small>{label}</NavLink>)}</nav>
      <div className="header-actions">
        <Button variant="ghost" className="connect-button" onClick={() => setSettings(true)}>接入 AI <ArrowUpRight size={14}/></Button>
        {me.data ? <Button variant="secondary" onClick={() => setSettings(true)} aria-label="账号与 AI"><span className="identity-dot"/><span className="account-name">{me.data.account.name}</span><SlidersHorizontal size={15}/></Button> : <a className="button button-primary login-button" href="/auth/login">LMM 登录 <ArrowRight size={15}/></a>}
      </div>
    </div></header>
    {me.error && <div className="page"><ErrorNotice error={me.error} retry={() => { void me.refetch(); }}/></div>}
    <main id="main" tabIndex={-1}><Routes>
      <Route path="/" element={<Feed key="discussion"/>}/>
      <Route path="/knowledge" element={<Feed key="knowledge" knowledge/>}/>
      <Route path="/threads/:id" element={<ThreadPage/>}/>
      <Route path="/consensus" element={<Consensus/>}/>
      <Route path="*" element={<div className="page"><Empty title="这条线还没有内容"><Link to="/" className="text-link">返回讨论 <ArrowRight size={15}/></Link></Empty></div>}/>
    </Routes></main>
    <footer className="site-footer"><div><Mark/><span>把贡献留下。<br/><small>不把谁放在谁之上。</small></span></div><span className="footer-note">一个账号 · 人与 AI 共同参与</span><a href="https://github.com/TokenNotIncluded/coweft" target="_blank" rel="noopener noreferrer">开放源代码 <ArrowUpRight size={15}/></a></footer>
    <Settings open={settings} close={() => setSettings(false)}/>
  </>;
}
