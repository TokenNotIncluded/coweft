import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

// A local, deterministic typographic cloud. It is not a social graph or an
// activity metric. DOM links remain the sole accessible source of discussions.
export function DiscussionField({ active = true }: { active?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    let frame = 0, last = 0, time = 0, visible = true, width = 1, height = 1;
    let pointerX = 0, pointerY = 0, smoothX = 0, smoothY = 0;
    const symbols = ['·', '·', '+', ':', '×', '∗', '0', '1', '/', '{', '}'];
    const random = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    const points = Array.from({ length: 1250 }, (_, i) => {
      const theta = random(i + 1) * Math.PI * 2;
      const z = random(i + 501) * 2 - 1;
      const r = Math.cbrt(random(i + 1101));
      const radius = Math.sqrt(1 - z * z) * r;
      return { x: Math.cos(theta) * radius, y: Math.sin(theta) * radius, z: z * r, phase: random(i + 91) * 6.28, glyph: symbols[i % symbols.length] };
    });
    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const dark = document.documentElement.dataset.theme !== 'light';
      const rgb = dark ? '218,220,231' : '61,66,83';
      smoothX += (pointerX - smoothX) * .045; smoothY += (pointerY - smoothY) * .045;
      const scale = Math.min(width * .48, height * .76);
      const angle = time * .045 + smoothX * .14;
      const sin = Math.sin(angle), cos = Math.cos(angle);
      const projected = points.slice(0, width < 500 ? 450 : 1250).map((p, i) => {
        const shift = Math.sin(p.y * 3.1 + time * .14 + p.phase) * .04;
        const x = p.x * cos - p.z * sin;
        const z = p.x * sin + p.z * cos;
        const perspective = 1 / (1.8 - z * .3);
        const twist = Math.sin(p.y * 3.4 + time * .08) * .25;
        return { x: width / 2 + (x * .95 + twist * .3 + shift) * scale * perspective,
          y: height * .48 + (p.y * .86 + x * .06 + smoothY * .09) * scale * perspective,
          z, glyph: p.glyph, alpha: .1 + (z + 1) * .31, size: 7 + (z + 1) * 2, index: i };
      }).sort((a, b) => a.z - b.z);
      ctx.textAlign = 'center';
      for (const p of projected) {
        ctx.fillStyle = `rgba(${rgb},${p.alpha})`;
        ctx.font = `${p.size}px ui-monospace,SFMono-Regular,Consolas,monospace`;
        ctx.fillText(p.glyph, p.x, p.y);
      }
    };
    const tick = (stamp: number) => {
      if (stamp - last >= 1000 / 24) { time += .042; last = stamp; draw(); }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame); frame = 0; draw();
      if (visible && active && !paused && !reduced && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      const rect = el.getBoundingClientRect(); width = rect.width; height = rect.height;
      const ratio = Math.min(devicePixelRatio || 1, 1.5);
      el.width = Math.round(width * ratio); el.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); sync();
    };
    const move = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      pointerX = Math.max(-1, Math.min(1, (event.clientX - rect.left - width / 2) / width));
      pointerY = Math.max(-1, Math.min(1, (event.clientY - rect.top - height / 2) / height));
    };
    const ro = new ResizeObserver(resize); ro.observe(el);
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }); io.observe(el);
    const theme = new MutationObserver(sync); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    el.addEventListener('pointermove', move); document.addEventListener('visibilitychange', sync);
    resize();
    return () => { cancelAnimationFrame(frame); ro.disconnect(); io.disconnect(); theme.disconnect(); el.removeEventListener('pointermove', move); document.removeEventListener('visibilitychange', sync); };
  }, [active, paused, reduced]);
  return <div className="discussion-field" data-motion={!active ? 'inactive' : reduced ? 'reduced' : paused ? 'paused' : 'running'}>
    <canvas ref={canvas} aria-hidden="true"/>
    <div className="field-identity" aria-hidden="true"><span>○</span><i>+</i><span>✳</span><small>一个共同身份</small></div>
    <div className="field-controls"><span>空间示意</span><button type="button" onClick={() => setPaused(!paused)} disabled={reduced} aria-label={reduced ? '动效已随系统关闭' : paused ? '播放动效' : '暂停动效'} aria-pressed={paused || reduced}>{paused || reduced ? <Play size={12}/> : <Pause size={12}/>}</button></div>
  </div>;
}
