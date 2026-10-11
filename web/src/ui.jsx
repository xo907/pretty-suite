import { useState } from 'react';
import { X } from 'lucide-react';

export const cx = (...parts) => parts.filter(Boolean).join(' ');

export function PageHeader({ icon: Icon, title, subtitle, tone = 'violet', children }) {
  const tones = {
    violet: 'text-accent-300',
    red: 'text-red-300',
  };
  return (
    <header className="mb-7 flex flex-wrap items-center gap-4">
      {Icon && (
        <div className={cx('grid size-11 place-items-center rounded-full border border-white/[0.08] bg-white/[0.03]', tones[tone])}>
          <Icon className="size-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-[22px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  );
}

export function Card({ title, hint, action, className, children }) {
  return (
    <section className={cx('card rise p-5', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
            {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Toggle({ checked, onChange, label, hint, tone = 'violet' }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full transition',
          checked ? (tone === 'red' ? 'bg-red-400' : 'bg-accent-400') : 'bg-white/[0.12]'
        )}
      >
        <span className={cx('absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform', checked && 'translate-x-4')} />
      </button>
      <span className="min-w-0">
        <span className="block text-sm text-zinc-200">{label}</span>
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
    </label>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-full border border-white/[0.08] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cx(
            'cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors',
            value === option.value ? 'bg-accent-400 text-accent-900' : 'text-zinc-400 hover:text-zinc-200'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'cursor-pointer rounded-full border px-3 py-1 text-xs transition',
        active ? 'border-accent-400 bg-accent-400 text-accent-900' : 'border-white/[0.08] text-zinc-400 hover:text-zinc-200'
      )}
    >
      {children}
    </button>
  );
}

const HUES = [262, 330, 200, 160, 20, 290, 45, 230];
export function Avatar({ src, name = '?', size = 32, square = false }) {
  const [broken, setBroken] = useState(false);
  const hue = HUES[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % HUES.length];
  const style = { width: size, height: size, fontSize: size * 0.4 };
  const shape = square ? 'rounded-[30%]' : 'rounded-full';
  if (src && !broken) {
    return <img src={src} alt="" style={style} onError={() => setBroken(true)} className={cx('shrink-0 object-cover', shape)} />;
  }
  return (
    <span
      style={{ ...style, background: `hsl(${hue} 22% 16%)`, color: `hsl(${hue} 55% 78%)` }}
      className={cx('grid shrink-0 place-items-center font-medium uppercase', shape)}
    >
      {name.trim()[0] || '?'}
    </span>
  );
}

export function Stat({ icon: Icon, label, value, hint }) {
  return (
    <div className="card rise p-4">
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <div className="mt-1.5 font-display text-[22px] font-medium tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="card rise w-full max-w-md bg-raised p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">{title}</h3>
          <button className="cursor-pointer text-zinc-500 hover:text-zinc-200" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div className="text-sm text-zinc-300">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="grid place-items-center px-6 py-14 text-center">
      {Icon && <Icon className="mb-3 size-8 text-zinc-600" />}
      <div className="text-sm font-medium text-zinc-300">{title}</div>
      {children && <div className="mt-1 max-w-sm text-xs text-zinc-500">{children}</div>}
    </div>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{children}</div>;
}
