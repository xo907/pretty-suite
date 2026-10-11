import { useRef, useState } from 'react';
import { DoorOpen, FolderOpen, Loader2, Lock, Mail, MessageCircle, PackageOpen, RefreshCw, Send, Sparkles, Trash2, Upload, Users } from 'lucide-react';
import { api, fmtNumber, useFetch } from '../api.js';
import { importPackage } from '../packageReader.js';
import { Avatar, ErrorNote, cx } from '../ui.jsx';
import { Box } from './TargetPicker.jsx';

const STEPS = [
  {
    icon: Send,
    title: 'Request your data',
    text: (
      <>
        In Discord, open <b>User Settings → Data &amp; Privacy</b> and choose <b>Request all of my data</b>. If it asks what to include,
        only <b>Messages</b> is needed.
      </>
    ),
  },
  {
    icon: Mail,
    title: 'Wait for the email',
    text: 'Discord emails you a download link. It usually arrives within a few days, though it can take up to 30.',
  },
  {
    icon: Upload,
    title: 'Drop the zip here',
    text: 'Download the file and drop it below, exactly as it came. There is no need to unzip it.',
  },
];

function SectionTitle({ icon: Icon, children, badge, badgeTone }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-1 pb-2">
      <Icon className="size-4 text-zinc-400" />
      <span className="text-sm font-semibold text-zinc-100">{children}</span>
      <span className={cx('ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-medium', badgeTone)}>{badge}</span>
    </div>
  );
}

/**
 * Explains, imports and lists the Discord data package: the only way to reach closed DMs and servers you left.
 * `value` / `onChange` hold the selected closed-DM channel IDs as { [id]: true }.
 */
export default function PackagePanel({ value, onChange, demo, refreshKey }) {
  const { data, loading, reload } = useFetch('/api/discord/package', [refreshKey]);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const zipInput = useRef(null);
  const folderInput = useRef(null);

  const run = async (work) => {
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      await work();
      onChange({});
      reload();
    } catch (err) {
      setError(err.message);
    }
    setProgress(null);
  };
  const importFiles = (fileList) => {
    const files = [...fileList];
    if (files.length) run(() => importPackage(files, (done, total) => setProgress({ done, total })));
  };
  const recheck = () => api.get('/api/discord/directory?refresh=1').then(reload);
  const remove = () => api.post('/api/discord/package/clear').then(() => (onChange({}), reload()));

  if (loading) return null;

  const pickers = (
    <>
      <input ref={zipInput} type="file" accept=".zip" hidden onChange={(e) => (importFiles(e.target.files), (e.target.value = ''))} />
      <input ref={folderInput} type="file" webkitdirectory="" hidden onChange={(e) => (importFiles(e.target.files), (e.target.value = ''))} />
    </>
  );

  if (progress) {
    const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <section className="card p-6 text-center">
        <Loader2 className="mx-auto size-6 animate-spin text-accent-300" />
        <div className="mt-3 text-sm font-medium">Reading your data package…</div>
        <div className="mt-1 text-xs text-zinc-500">
          {progress.total ? `${fmtNumber(progress.done)} of ${fmtNumber(progress.total)} conversations` : 'Opening the file'}
        </div>
        <div className="mx-auto mt-4 h-1.5 max-w-xs overflow-hidden rounded-full bg-white/8">
          <div className="h-full rounded-full bg-accent-400 transition-all" style={{ width: `${percent}%` }} />
        </div>
      </section>
    );
  }

  // ── Nothing imported yet: explain what this is and how to get it ──────────────────────────────
  if (!data?.imported) {
    return (
      <section className="card rise p-5">
        {pickers}
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-white/[0.03]">
            <PackageOpen className="size-5 text-accent-200" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Reach closed DMs and servers you left</h2>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              The list above is everything Discord will show an app: servers you are in right now, and DMs you currently have open. It
              has no record of the rest. Your <b className="text-zinc-200">Discord data package</b> does — it lists every place you
              have ever sent a message. Import it and those places show up here too.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-200">
              <MessageCircle className="size-3.5" /> Closed DMs — can be purged
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-400">
              Closing a DM only hides it. Your messages are still there, and with their IDs from the package they can be deleted directly.
            </p>
          </div>
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
              <DoorOpen className="size-3.5" /> Servers you left — need a rejoin
            </div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-400">
              Discord refuses deletions in servers you are not in. You will see which ones still hold your messages, so you know where to
              rejoin.
            </p>
          </div>
        </div>

        <ol className="mt-4 space-y-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-zinc-200">{i + 1}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-200">
                  <step.icon className="size-3.5 text-accent-300" /> {step.title}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 [&_b]:font-medium [&_b]:text-zinc-300">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <div
          onDragOver={(e) => (e.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => (e.preventDefault(), setDragging(false), importFiles(e.dataTransfer.files))}
          className={cx(
            'mt-4 rounded-xl border-2 border-dashed px-4 py-6 text-center transition',
            dragging ? 'border-accent-400 bg-accent-500/10' : 'border-white/12 bg-black/20'
          )}
        >
          <Upload className="mx-auto size-5 text-zinc-500" />
          <div className="mt-2 text-sm text-zinc-300">Drop your data package zip here</div>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => zipInput.current.click()}>
              <Upload className="size-3.5" /> Choose zip
            </button>
            <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => folderInput.current.click()}>
              <FolderOpen className="size-3.5" /> Already unzipped? Choose folder
            </button>
            {demo && (
              <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => run(() => api.post('/api/discord/package/sample'))}>
                <Sparkles className="size-3.5" /> Load a sample package
              </button>
            )}
          </div>
        </div>
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>

        <p className="mt-3 flex gap-2 text-[11.5px] leading-relaxed text-zinc-500">
          <Lock className="mt-0.5 size-3.5 shrink-0" />
          The file is opened right here in your browser and is not uploaded anywhere. Only your own message list is copied into the vault
          folder on this computer, and you can remove it at any time.
        </p>
      </section>
    );
  }

  // ── Imported: show what it unlocked ───────────────────────────────────────────────────────────
  const { closedDms, leftServers, leftGroups, covered, totals } = data;
  const allSelected = closedDms.length > 0 && closedDms.every((dm) => value[dm.id]);
  const toggle = (id) => {
    const next = { ...value };
    next[id] ? delete next[id] : (next[id] = true);
    onChange(next);
  };
  const selectedMessages = closedDms.filter((dm) => value[dm.id]).reduce((sum, dm) => sum + dm.count, 0);

  return (
    <section className="card rise p-0">
      {pickers}
      <div className="flex items-center gap-3 border-b border-white/8 p-4">
        <PackageOpen className="size-5 shrink-0 text-accent-300" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">From your data package</div>
          <div className="text-xs text-zinc-500">
            {fmtNumber(totals.messages)} of your messages across {fmtNumber(totals.channels)} places · imported{' '}
            {new Date(data.imported).toLocaleDateString()}
          </div>
        </div>
        <button className="btn btn-ghost px-2.5 py-1.5 text-xs" title="Import a newer package" onClick={() => zipInput.current.click()}>
          <Upload className="size-3.5" /> Replace
        </button>
        <button className="btn btn-ghost px-2.5 py-1.5 text-xs" title="Remove the imported package from this computer" onClick={remove}>
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="space-y-5 p-4">
        <ErrorNote>{error}</ErrorNote>

        <div>
          <SectionTitle icon={MessageCircle} badge="Ready to purge" badgeTone="bg-emerald-400/15 text-emerald-300">
            Closed DMs · {closedDms.length}
          </SectionTitle>
          <p className="px-1 pb-2 text-xs leading-relaxed text-zinc-500">
            Conversations you closed that still contain your messages. Tick the ones to include — they are purged alongside whatever you
            pick in the list above, using the same date, text and regex filters.
          </p>
          {closedDms.length === 0 ? (
            <div className="rounded-xl bg-black/20 px-3 py-3 text-xs text-zinc-500">
              None left — every DM in your package is either still open (so it is in the list above) or already purged.
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-xl bg-black/20 p-1.5">
              <div className="flex items-center gap-2.5 px-2 py-1.5">
                <Box state={allSelected} onClick={() => onChange(allSelected ? {} : Object.fromEntries(closedDms.map((dm) => [dm.id, true])))} />
                <span className="text-[11px] font-semibold tracking-wider text-zinc-500 uppercase">Select all</span>
                {selectedMessages > 0 && <span className="ml-auto text-[11px] text-accent-300">{fmtNumber(selectedMessages)} messages selected</span>}
              </div>
              {closedDms.map((dm) => (
                <div key={dm.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/5">
                  <Box state={Boolean(value[dm.id])} onClick={() => toggle(dm.id)} />
                  <Avatar size={24} name={dm.name} />
                  <span className="truncate text-sm text-zinc-200">{dm.name}</span>
                  <span className="ml-auto text-xs text-zinc-500 tabular-nums">{fmtNumber(dm.count)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="px-1 pt-2 text-[11px] text-zinc-600">
            The package has no pin or attachment-type details, so for these the “only messages that have” filter means “has any attachment”.
          </p>
        </div>

        {leftServers.length > 0 && (
          <div>
            <SectionTitle icon={DoorOpen} badge="Rejoin to purge" badgeTone="bg-amber-400/15 text-amber-300">
              Servers you left · {leftServers.length}
            </SectionTitle>
            <p className="px-1 pb-2 text-xs leading-relaxed text-zinc-500">
              Your messages are still in these servers, but Discord only allows deleting inside a server you are a member of. Rejoin one
              with an invite, press <b className="font-medium text-zinc-300">Check again</b>, and it moves into the Servers list above,
              ready to purge.
            </p>
            <div className="max-h-56 overflow-y-auto rounded-xl bg-black/20 p-1.5">
              {leftServers.map((server) => (
                <div key={server.id} className="flex items-center gap-2.5 px-2 py-1.5">
                  <Avatar square size={24} name={server.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-zinc-200">{server.name}</span>
                    {!server.known && (
                      <span className="block text-[11px] text-zinc-600">Discord did not include a server name — it may have been deleted.</span>
                    )}
                  </span>
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {fmtNumber(server.count)} in {server.channels} {server.channels === 1 ? 'channel' : 'channels'}
                  </span>
                </div>
              ))}
            </div>
            <button className="btn btn-ghost mt-2 px-3 py-1.5 text-xs" onClick={recheck}>
              <RefreshCw className="size-3.5" /> Check again
            </button>
          </div>
        )}

        {leftGroups.length > 0 && (
          <div>
            <SectionTitle icon={Users} badge="Out of reach" badgeTone="bg-white/10 text-zinc-400">
              Group chats you left · {leftGroups.length}
            </SectionTitle>
            <p className="px-1 text-xs leading-relaxed text-zinc-500">
              {fmtNumber(leftGroups.reduce((sum, g) => sum + g.count, 0))} of your messages are in group chats you are no longer part of.
              They can only be purged if someone in the group adds you back.
            </p>
          </div>
        )}

        {covered.places > 0 && (
          <p className="rounded-xl bg-black/20 px-3 py-2.5 text-xs leading-relaxed text-zinc-500">
            The other {fmtNumber(covered.places)} places in your package ({fmtNumber(covered.messages)} messages) are servers and DMs you
            still have access to, so they are already in the list above.
          </p>
        )}
      </div>
    </section>
  );
}
