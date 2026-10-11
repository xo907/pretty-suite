// Pacing for every job on every platform. A fixed gap, or one varied evenly around a number, is the rhythm of a
// script. People are right-skewed: most gaps a little shorter than their usual, a few much longer; they speed up
// and slow down over a sitting, stop for a minute now and then, and take time to type.

const gaussian = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

/** A wait centred on `seconds` (its median), log-normally spread, with the occasional lapse of attention. */
export function humanSeconds(seconds) {
  let wait = seconds * Math.exp(0.38 * gaussian());
  if (Math.random() < 0.04) wait += seconds * (2 + Math.random() * 5);
  return Math.max(seconds * 0.45, wait);
}

/**
 * One job's rhythm. Kept in ctx.state so a restart carries on in the same sitting.
 *   wait(seconds)  the gap after an action
 *   type(text)     the time it takes to write that much
 *   glance()       a look at something before acting on it
 * `scale` shrinks everything for the demo.
 */
export function pacer(ctx, { scale = 1, breaks = true } = {}) {
  const r = (ctx.state.rhythm ??= { tempo: 1, count: 0, breakAt: 0 });
  const nextBreak = () => 14 + Math.floor(Math.random() * 32);
  if (!r.breakAt) r.breakAt = nextBreak();
  const sleep = (seconds) => ctx.sleep(Math.max(0, seconds) * 1000 * scale);

  return {
    async wait(seconds) {
      // Tempo drifts a little with every action instead of jumping about.
      r.tempo = Math.min(1.4, Math.max(0.75, r.tempo + 0.06 * gaussian()));
      await sleep(humanSeconds(seconds) * r.tempo);
      if (breaks && ++r.count >= r.breakAt) {
        r.count = 0;
        r.breakAt = nextBreak();
        const rest = Math.min(300, Math.max(25, 75 * Math.exp(0.6 * gaussian())));
        if (scale === 1) ctx.log('info', `Short break (${rest < 90 ? 'about a minute' : `about ${Math.round(rest / 60)} minutes`}), then carrying on.`);
        await sleep(rest);
      }
    },
    type: (text) => sleep(Math.min(8, Math.max(1.5, String(text || '').length / (4 + Math.random() * 4))) + Math.random()),
    glance: () => sleep(0.8 + Math.random() * 2.4),
  };
}
