import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

/** Two typographic ribbons, drawn locally. No video, texture download, WebGL
 * dependency or React renders per frame. This is a motif, not live telemetry. */
export function WeaveField() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    let width = 0, height = 0, frame = 0, last = 0, time = 0, visible = true;
    const pointer = { x: -1000, y: -1000 };
    const glyphs = ['·', ':', '+', '/', '0', '1', '×', '=', '{', '}'];
    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.font = '10px ui-monospace, SFMono-Regular, Consolas, monospace';
      context.textAlign = 'center';
      const columns = width < 400 ? 27 : 39;
      const rows = width < 400 ? 7 : 10;
      const points: { x: number; y: number; depth: number; band: number; char: string }[] = [];
      for (let band = 0; band < 2; band++) {
        for (let row = 0; row < rows; row++) {
          for (let column = 0; column < columns; column++) {
            const u = column / (columns - 1) * 2 - 1;
            const v = row / (rows - 1) * 2 - 1;
            const phase = time * 0.17;
            let x = band === 0 ? u * width * .45 : Math.sin(u * 2.2 - phase) * width * .26 + v * width * .1;
            let y = band === 0 ? Math.sin(u * 2.7 + phase) * height * .23 + v * height * .16 : u * height * .41;
            const depth = Math.cos(u * 2.4 + phase + band * 2) * .7 + v * .15;
            const rotatedX = x * .96 - y * .28;
            y = x * .28 + y * .96;
            x = rotatedX;
            x = width / 2 + x / (1 + depth * .18);
            y = height / 2 + y / (1 + depth * .18);
            const dx = x - pointer.x, dy = y - pointer.y, distance = Math.hypot(dx, dy);
            if (!reduced && distance > 0 && distance < 85) {
              const push = (1 - distance / 85) * 14;
              x += dx / distance * push; y += dy / distance * push;
            }
            points.push({ x, y, depth, band, char: glyphs[(column * 7 + row * 3 + band) % glyphs.length] });
          }
        }
      }
      points.sort((a, b) => a.depth - b.depth);
      for (const point of points) {
        const opacity = .18 + (point.depth + 1) * .34;
        context.fillStyle = point.band ? `rgba(217,240,163,${opacity})` : `rgba(189,192,177,${opacity * .8})`;
        context.fillText(point.char, point.x, point.y);
      }
    };
    const tick = (timestamp: number) => {
      if (timestamp - last > 1000 / 24) { time += .042; last = timestamp; draw(); }
      frame = requestAnimationFrame(tick);
    };
    const synchronize = () => {
      cancelAnimationFrame(frame); frame = 0;
      draw();
      if (!paused && !reduced && visible && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      const rect = element.getBoundingClientRect(); width = rect.width; height = rect.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0); synchronize();
    };
    const observer = new ResizeObserver(resize); observer.observe(element);
    const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; synchronize(); });
    intersection.observe(element);
    const move = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect(); pointer.x = event.clientX - rect.left; pointer.y = event.clientY - rect.top;
    };
    const leave = () => { pointer.x = pointer.y = -1000; };
    document.addEventListener('visibilitychange', synchronize);
    element.addEventListener('pointermove', move); element.addEventListener('pointerleave', leave);
    resize();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect();
      document.removeEventListener('visibilitychange', synchronize);
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerleave', leave);
    };
  }, [paused, reduced]);
  return <div className="loom" data-motion={reduced ? 'reduced' : paused ? 'paused' : 'running'}>
    <div className="loom-label"><span>HUMAN</span><span className="loom-cross">×</span><span>AGENT</span></div>
    <canvas ref={canvas} aria-hidden="true"/>
    <div className="loom-bottom"><span>两种思考，一条共同的线。<small>交互示意 · 非实时数据</small></span><button type="button" className="motion-toggle" onClick={() => setPaused(value => !value)} disabled={reduced} aria-label={reduced ? '动效已随系统关闭' : paused ? '播放动效' : '暂停动效'} aria-pressed={paused || reduced}>{paused || reduced ? <Play size={13}/> : <Pause size={13}/>}</button></div>
  </div>;
}
