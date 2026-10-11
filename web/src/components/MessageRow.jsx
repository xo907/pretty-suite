import { Flag, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { avatarUrl, fmtTime } from '../api.js';
import { Avatar, cx } from '../ui.jsx';

const isImage = (a) => (a.content_type || '').startsWith('image/');

export default function MessageRow({ message: m, showWhere = true }) {
  const where = m.guild_name ? `${m.guild_name} › #${m.channel_name ?? m.channel_id}` : m.channel_name ? `DM · ${m.channel_name}` : m.channel_id;
  return (
    <article
      className={cx(
        'rise flex gap-3 rounded-xl border px-3.5 py-3',
        m.deleted_ts ? 'border-red-500/25 bg-red-500/[0.06]' : m.flagged ? 'border-amber-400/30 bg-amber-400/[0.05]' : 'border-white/6 bg-white/[0.025]'
      )}
    >
      <Avatar size={34} name={m.author_name || '?'} src={avatarUrl(m.author_id, m.author_avatar)} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={cx('text-sm font-semibold', m.mine ? 'text-accent-200' : 'text-zinc-100')}>{m.author_name || 'Unknown'}</span>
          {showWhere && <span className="truncate text-xs text-zinc-500">{where}</span>}
          <span className="text-xs text-zinc-600">{fmtTime(m.ts)}</span>
          {m.deleted_ts && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10.5px] font-medium text-red-300">
              <Trash2 className="size-3" /> deleted {fmtTime(m.deleted_ts)}
            </span>
          )}
          {m.edits?.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10.5px] font-medium text-sky-300">
              <Pencil className="size-3" /> edited ×{m.edits.length}
            </span>
          )}
          {Boolean(m.flagged) && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-300">
              <Flag className="size-3" /> keyword
            </span>
          )}
        </div>

        {m.content && <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-zinc-300">{m.content}</p>}

        {m.edits?.map((edit, i) => (
          <p key={i} className="mt-1 border-l-2 border-sky-400/30 pl-2 text-xs break-words whitespace-pre-wrap text-zinc-500 line-through">
            {edit.old_content}
          </p>
        ))}

        {m.attachments?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {m.attachments.map((a) => {
              const href = a.local ? `/files/${a.local}` : a.url;
              return a.local && isImage(a) ? (
                <a key={a.id} href={href} target="_blank" rel="noreferrer">
                  <img src={href} alt={a.filename} className="max-h-40 rounded-lg border border-white/10" />
                </a>
              ) : (
                <a
                  key={a.id}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/10"
                >
                  <Paperclip className="size-3" /> {a.filename}
                  {a.local && <span className="text-emerald-400">saved</span>}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}
