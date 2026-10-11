import { useMemo, useState } from 'react';
import { Check, ChevronRight, Hash, Loader2, Minus, RefreshCw, Search, Users } from 'lucide-react';
import { api, avatarUrl, iconUrl, useFetch } from '../api.js';
import { Avatar, cx } from '../ui.jsx';

export const emptySelection = () => ({ dms: {}, guilds: {} });

export function countSelection(selection) {
  return Object.keys(selection.dms).length + Object.values(selection.guilds).filter((v) => v === true || Object.keys(v).length).length;
}

export function Box({ state, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'grid size-[18px] shrink-0 cursor-pointer place-items-center rounded-md border transition',
        state ? 'border-accent-400 bg-accent-500 text-white' : 'border-white/20 bg-black/30 hover:border-white/40'
      )}
    >
      {state === 'some' ? <Minus className="size-3" /> : state ? <Check className="size-3" /> : null}
    </button>
  );
}

/**
 * Pick DMs, whole servers, or individual channels inside a server.
 * Selection shape: { dms: { [channelId]: true }, guilds: { [guildId]: true | { [channelId]: true } } }
 */
export default function TargetPicker({ value, onChange, className }) {
  const { data, loading, reload } = useFetch('/api/discord/directory');
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState({});
  const [channels, setChannels] = useState({});

  const needle = filter.trim().toLowerCase();
  const dms = useMemo(() => (data?.dms || []).filter((d) => d.name.toLowerCase().includes(needle)), [data, needle]);
  const guilds = useMemo(() => (data?.guilds || []).filter((g) => g.name.toLowerCase().includes(needle)), [data, needle]);

  const setDm = (id, on) => {
    const next = { ...value.dms };
    on ? (next[id] = true) : delete next[id];
    onChange({ ...value, dms: next });
  };
  const setGuild = (id, next) => {
    const guildsNext = { ...value.guilds };
    next === false || (next !== true && !Object.keys(next).length) ? delete guildsNext[id] : (guildsNext[id] = next);
    onChange({ ...value, guilds: guildsNext });
  };
  const toggleChannel = (guildId, channelId) => {
    const current = value.guilds[guildId];
    // A fully selected server becomes "every channel except this one".
    const base = current === true ? Object.fromEntries((channels[guildId] || []).map((c) => [c.id, true])) : { ...(current || {}) };
    base[channelId] ? delete base[channelId] : (base[channelId] = true);
    setGuild(guildId, base);
  };
  const expand = async (guildId) => {
    setOpen((o) => ({ ...o, [guildId]: !o[guildId] }));
    if (channels[guildId]) return;
    try {
      const list = await api.get(`/api/discord/guilds/${guildId}/channels`);
      setChannels((c) => ({ ...c, [guildId]: list }));
    } catch {
      setChannels((c) => ({ ...c, [guildId]: [] }));
    }
  };

  const allDms = dms.length > 0 && dms.every((d) => value.dms[d.id]);
  const allGuilds = guilds.length > 0 && guilds.every((g) => value.guilds[g.id] === true);

  return (
    <div className={cx('card flex min-h-0 flex-col p-0', className)}>
      <div className="flex items-center gap-2 border-b border-white/8 p-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-zinc-500" />
          <input className="input pl-9" placeholder="Filter servers and conversations" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button className="btn btn-ghost px-2.5" title="Refresh from Discord" onClick={() => api.get('/api/discord/directory?refresh=1').then(reload)}>
          <RefreshCw className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && <div className="grid place-items-center py-10 text-zinc-500"><Loader2 className="size-5 animate-spin" /></div>}

        {dms.length > 0 && (
          <>
            <div className="flex items-center gap-2.5 px-2 pt-2 pb-1.5">
              <Box state={allDms} onClick={() => onChange({ ...value, dms: allDms ? {} : Object.fromEntries(dms.map((d) => [d.id, true])) })} />
              <span className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">Direct messages · {dms.length}</span>
            </div>
            {dms.map((dm) => (
              <div key={dm.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/5">
                <Box state={Boolean(value.dms[dm.id])} onClick={() => setDm(dm.id, !value.dms[dm.id])} />
                {dm.group ? (
                  <span className="grid size-6 place-items-center rounded-full bg-white/10"><Users className="size-3.5 text-zinc-300" /></span>
                ) : (
                  <Avatar size={24} name={dm.name} src={avatarUrl(dm.userId, dm.avatar)} />
                )}
                <span className="truncate text-sm text-zinc-200">{dm.name}</span>
              </div>
            ))}
          </>
        )}

        {guilds.length > 0 && (
          <>
            <div className="flex items-center gap-2.5 px-2 pt-4 pb-1.5">
              <Box
                state={allGuilds}
                onClick={() => onChange({ ...value, guilds: allGuilds ? {} : Object.fromEntries(guilds.map((g) => [g.id, true])) })}
              />
              <span className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">Servers · {guilds.length}</span>
            </div>
            {guilds.map((guild) => {
              const selected = value.guilds[guild.id];
              const state = selected === true ? true : selected && Object.keys(selected).length ? 'some' : false;
              return (
                <div key={guild.id}>
                  <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/5">
                    <Box state={state} onClick={() => setGuild(guild.id, state === true ? false : true)} />
                    <Avatar square size={24} name={guild.name} src={iconUrl(guild.id, guild.icon)} />
                    <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left" onClick={() => expand(guild.id)}>
                      <span className="truncate text-sm text-zinc-200">{guild.name}</span>
                      <ChevronRight className={cx('ml-auto size-4 shrink-0 text-zinc-500 transition-transform', open[guild.id] && 'rotate-90')} />
                    </button>
                  </div>
                  {open[guild.id] && (
                    <div className="mb-1 ml-[19px] border-l border-white/8 pl-3">
                      {!channels[guild.id] && <div className="px-2 py-2 text-xs text-zinc-500">Loading channels…</div>}
                      {channels[guild.id]?.length === 0 && <div className="px-2 py-2 text-xs text-zinc-500">No readable channels.</div>}
                      {channels[guild.id]?.map((channel) => (
                        <div key={channel.id} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-white/5">
                          <Box state={selected === true || Boolean(selected?.[channel.id])} onClick={() => toggleChannel(guild.id, channel.id)} />
                          <Hash className="size-3.5 shrink-0 text-zinc-500" />
                          <span className="truncate text-[13px] text-zinc-300">{channel.name}</span>
                          {channel.category && <span className="ml-auto truncate text-[11px] text-zinc-600">{channel.category}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="border-t border-white/8 px-4 py-2.5 text-xs text-zinc-400">
        {countSelection(value) ? `${countSelection(value)} selected` : 'Nothing selected yet'}
      </div>
    </div>
  );
}
