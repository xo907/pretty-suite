import { useState } from 'react';
import { BarChart3, Ghost, Hash, MessagesSquare, Paperclip, Pencil, Users } from 'lucide-react';
import { fmtNumber, useFetch } from '../api.js';
import { Card, Empty, PageHeader, Segmented, Stat } from '../ui.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Timeline({ perDay }) {
  // Fill gaps so quiet days show as empty slots rather than being skipped.
  const byDay = new Map(perDay.map((d) => [d.day, d.count]));
  const days = Array.from({ length: 120 }, (_, i) => {
    const date = new Date(Date.now() - (119 - i) * 86400000);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return { key, count: byDay.get(key) || 0 };
  });
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <>
      <div className="flex h-36 items-end gap-[2px]">
        {days.map((d) => (
          <div
            key={d.key}
            title={`${d.key}: ${fmtNumber(d.count)} message(s)`}
            className="flex-1 rounded-t-sm bg-accent-400/70 transition-colors hover:bg-accent-300"
            style={{ height: d.count ? `${Math.max(3, (d.count / max) * 100)}%` : '1px', opacity: d.count ? 1 : 0.25 }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-zinc-500">
        <span>{days[0].key}</span>
        <span>peak {fmtNumber(max)} / day</span>
        <span>today</span>
      </div>
    </>
  );
}

function Heatmap({ heat }) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const cell of heat) grid[cell.dow][cell.hour] = cell.count;
  const max = Math.max(1, ...heat.map((c) => c.count));
  return (
    <div className="space-y-[3px]">
      {grid.map((row, dow) => (
        <div key={dow} className="flex items-center gap-[3px]">
          <span className="w-8 text-[11px] text-zinc-500">{DAYS[dow]}</span>
          {row.map((count, hour) => (
            <div
              key={hour}
              title={`${DAYS[dow]} ${String(hour).padStart(2, '0')}:00 — ${fmtNumber(count)} message(s)`}
              className="h-4 flex-1 rounded-[3px]"
              style={{ background: count ? `rgb(167 139 250 / ${0.15 + 0.85 * (count / max)})` : 'rgb(255 255 255 / 0.04)' }}
            />
          ))}
        </div>
      ))}
      <div className="flex gap-[3px] pt-1 pl-[35px] text-[10px] text-zinc-600">
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className="flex-1 text-center">{hour % 6 === 0 ? `${hour}h` : ''}</span>
        ))}
      </div>
    </div>
  );
}

function Ranking({ rows, icon: Icon }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="space-y-2.5">
      {rows.map((row, i) => (
        <div key={i}>
          <div className="flex items-baseline gap-2 text-sm">
            <Icon className="size-3.5 shrink-0 self-center text-zinc-500" />
            <span className="truncate text-zinc-200">{row.name}</span>
            {row.guild_name && <span className="truncate text-xs text-zinc-600">{row.guild_name}</span>}
            <span className="ml-auto text-xs text-zinc-400 tabular-nums">{fmtNumber(row.count)}</span>
          </div>
          <div className="mt-1 h-1 rounded-full bg-white/6">
            <div className="h-full rounded-full bg-accent-400/80" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Insights() {
  const [mine, setMine] = useState('');
  const { data } = useFetch(`/api/vault/insights?mine=${mine}`);
  const totals = data?.totals;

  return (
    <>
      <PageHeader icon={BarChart3} title="Insights" subtitle="Patterns in everything your vault has collected.">
        <Segmented
          value={mine}
          onChange={setMine}
          options={[
            { value: '', label: 'Everyone' },
            { value: '1', label: 'Mine' },
            { value: '0', label: 'Others' },
          ]}
        />
      </PageHeader>

      {!totals?.messages ? (
        <div className="card">
          <Empty icon={BarChart3} title="No data yet">Archive a few conversations or run the live logger, then come back.</Empty>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Stat icon={MessagesSquare} label="Messages" value={fmtNumber(totals.messages)} />
            <Stat icon={Users} label="People" value={fmtNumber(totals.people)} />
            <Stat icon={Paperclip} label="With attachments" value={fmtNumber(totals.withFiles)} />
            <Stat icon={Ghost} label="Deletions caught" value={fmtNumber(totals.deleted)} />
            <Stat icon={Pencil} label="Edits caught" value={fmtNumber(data.edits)} />
          </div>

          <Card title="Messages per day" hint="Last 120 days" className="mt-5">
            <Timeline perDay={data.perDay} />
          </Card>

          <Card title="When the talking happens" hint="By weekday and hour, in your local time" className="mt-5">
            <Heatmap heat={data.heat} />
          </Card>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card title="Busiest places">
              <Ranking rows={data.topChannels} icon={Hash} />
            </Card>
            <Card title="Most active people">
              <Ranking rows={data.topPeople} icon={Users} />
            </Card>
          </div>
        </>
      )}
    </>
  );
}
