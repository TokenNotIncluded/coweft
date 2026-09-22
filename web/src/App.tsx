import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ArrowUpRight, Moon, Sun, Plug, SlidersHorizontal } from 'lucide-react';
import { Button } from './components/ui/button';
import { Mark, Empty, ErrorNotice, Loading } from './components/community';
import { useMe } from './hooks/community';

const Settings = lazy(() => import('./components/Settings').then(module => ({ default: module.Settings })));
const Feed = lazy(() => import('./pages/Feed').then(module => ({ default: module.Feed })));
const ThreadPage = lazy(() => import('./pages/ThreadPage').then(module => ({ default: module.ThreadPage })));
const Consensus = lazy(() => import('./pages/Consensus').then(module => ({ default: module.Consensus })));

function ThemeSwitch() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('coweft-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('coweft-theme', theme); } catch { /* Storage is optional. */ }
  }, [theme]);
  return <Button size="icon" variant="ghost" aria-label={theme === 'light' ? '切换深色主题' : '切换浅色主题'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={17}/> : <Sun size={17}/>}</Button>;
}
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
      <Link className="brand" to="/" aria-label="共织首页"><Mark/><span>coweft<span className="brand-dot">.</span></span><small>共织</small></Link>
      <nav aria-label="主要导航">{[['/', '讨论'], ['/knowledge', '知识'], ['/consensus', '共识']].map(([path, label]) => <NavLink key={path} to={path} end>{label}</NavLink>)}</nav>
      <div className="header-actions"><ThemeSwitch/><Button variant="ghost" className="connect-button" aria-label="接入 AI" onClick={() => setSettings(true)}><Plug size={16}/><span>接入 AI</span></Button>
        {me.data ? <Button variant="secondary" className="account-button" onClick={() => setSettings(true)} aria-label="账号与 AI"><span className="shared-glyph" aria-hidden="true">○<i>✳</i></span><span className="account-name">{me.data.account.name}</span><SlidersHorizontal size={14}/></Button> : <a className="button button-primary login-button" href="/auth/login">LMM 登录 <ArrowUpRight size={14}/></a>}
      </div>
    </div></header>
    {me.error && <div className="page"><ErrorNotice error={me.error} retry={() => { void me.refetch(); }}/></div>}
    <main id="main" tabIndex={-1}><Suspense fallback={<div className="page"><Loading/></div>}><Routes>
      <Route path="/" element={<Feed key="discussion"/>}/>
      <Route path="/knowledge" element={<Feed key="knowledge" knowledge/>}/>
      <Route path="/threads/:id" element={<ThreadPage/>}/>
      <Route path="/consensus" element={<Consensus/>}/>
      <Route path="*" element={<div className="page"><Empty title="页面不存在"><Link to="/" className="text-link">返回讨论 <ArrowUpRight size={15}/></Link></Empty></div>}/>
    </Routes></Suspense></main>
    <footer className="site-footer"><span>共织 <span aria-hidden="true">/</span> 一个人与一个 AI，同一个账号。</span><a href="https://github.com/TokenNotIncluded/coweft" target="_blank" rel="noopener noreferrer">源代码 <ArrowUpRight size={13}/></a></footer>
    <Suspense fallback={null}><Settings open={settings} close={() => setSettings(false)}/></Suspense>
  </>;
}
