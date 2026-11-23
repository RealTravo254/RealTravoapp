export const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const dayNo = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
export const abs = (day, t) => dayNo(day) * 1440 + toMin(t);
export const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + n)); return x.toISOString().slice(0, 10); };
export const STAY = ['hotel', 'resort', 'campsite', 'airbnb'];
export const durationOf = (x) => Number(x?.duration_minutes) || (STAY.includes(x?.category) ? 60 : x?.category === 'event' ? 180 : 120);

const clash = (a, b, pad = 0) => a.s < b.e + pad && b.s < a.e + pad;

// Main booking + pickup + return trip as time blocks. t = { pickupTime, returnDate, returnTime } or null.
export function mainBlocks(listing, startDay, endDay, time, t) {
  const isTour = listing.schedule_type === 'tour';
  const s = abs(startDay, time);
  const e = isTour ? abs(endDay, '00:00') + 1440 : s + durationOf(listing);
  const blocks = [{ label: 'main booking', s, e }];
  const problems = [];
  if (t) {
    if (toMin(t.pickupTime) >= toMin(time)) problems.push('Pickup time must be before the booking start time.');
    else blocks.push({ label: 'pickup', s: abs(startDay, t.pickupTime), e: s });
    if (t.returnDate) {
      const rs = abs(t.returnDate, t.returnTime);
      if (rs < e) problems.push('Return time must be after the main booking ends.');
      else blocks.push({ label: 'return trip', s: rs, e: rs + 60 });
    }
  }
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++)
    if (clash(blocks[i], blocks[j])) problems.push(`Time clash: ${blocks[i].label} overlaps ${blocks[j].label}.`);
  return { blocks, problems };
}

// Add-ons may overlap the main booking. They only need `pad` minutes between each other.
export function addonClashes(_base, add, pad = 30) {
  const out = [];
  add.forEach((a, i) => add.forEach((b, j) => {
    if (j > i && clash(a, b, pad)) out.push(`${a.label} and ${b.label} are too close. Leave at least ${pad} minutes.`);
  }));
  return out;
}

// Used only to show a note. Overlapping the main booking is allowed.
export const overlapsBase = (a, base) => base.some((b) => a.s < b.e && b.s < a.e);

// First free slot between two days (08:00 to 22:00, every 30 minutes), avoiding the blocks in `taken`
export function freeSlot(taken, firstDay, lastDay, dur, pad = 30) {
  for (let d = firstDay; dayNo(d) <= dayNo(lastDay); d = addDays(d, 1))
    for (let m = 8 * 60; m + dur <= 22 * 60; m += 30) {
      const s = abs(d, hhmm(m));
      if (!taken.some((b) => s < b.e + pad && b.s < s + dur + pad)) return { date: d, time: hhmm(m) };
    }
  return null;
}
