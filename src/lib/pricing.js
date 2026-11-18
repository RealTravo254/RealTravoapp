// Totals: sum(items) minus best active offer; weekend-only offers apply on Fri-Sun starts.
export function bestOffer(offers = [], startDate) {
  const d = startDate ? new Date(startDate) : new Date();
  const iso = ymd(d);                         // local date, not UTC
  const wk = [0, 5, 6].includes(d.getDay());
  return offers.filter(o => iso >= o.starts_on && iso <= o.ends_on && (!o.weekend_only || wk))
    .sort((a, b) => b.percent_off - a.percent_off)[0] || null;
}
export function computeTotal(selection, prices, nights = 1, offer) {
  let subtotal = 0; const items = [];
  for (const [id, qty] of Object.entries(selection)) {
    if (!qty) continue;
    const p = prices.find(x => x.id === id); if (!p) continue;
    const mult = (p.unit === 'per_night' || p.unit === 'per_day') ? nights : 1;
    const amount = Number(p.price) * qty * mult;
    subtotal += amount; items.push({ price_id: id, label: `${p.label} (${p.audience})`, quantity: qty, unit_price: Number(p.price), amount });
  }
  const discount = offer ? Math.round(subtotal * offer.percent_off) / 100 : 0;
  return { items, subtotal, discount, total: subtotal - discount };
}
// Pickup transfer price = base_fee + price_per_km * km ; vehicle must seat every passenger
export function transferPrice(vehicle, km) { return vehicle ? Number(vehicle.base_fee) + Number(vehicle.price_per_km) * Number(km || 0) : 0; }

// Local calendar date (YYYY-MM-DD). Do not use toISOString(): it shifts the day in East Africa.
export const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const toMin = (hhmm) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
export const fromMin = (m) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

// Schedule rules (the database enforces the same): open days/hours, end dates, tour start day, one-time date. Returns a message or null.
export function scheduleProblem(l, date, time) {
  const at = new Date(`${date}T${time || '12:00'}:00`);
  if (time && at.getTime() < Date.now() + 3600000) return 'Choose a time at least 1 hour from now.';
  if (!time && date < ymd(new Date())) return 'Choose a date that is not in the past.';
  const type = l.schedule_type;
  if (type === 'range' && l.starts_on && l.ends_on && (date < l.starts_on || date > l.ends_on)) return `${l.title} is available from ${l.starts_on} to ${l.ends_on}.`;
  if (type === 'tour' && l.starts_on && date !== l.starts_on) return `This tour starts on ${l.starts_on}.`;
  if ((l.category === 'event' || type === 'one_time') && l.event_date && date !== ymd(new Date(l.event_date))) return `This takes place on ${ymd(new Date(l.event_date))}.`;
  if (l.category === 'event' || type === 'tour' || type === 'one_time') return null; // fixed date: no weekly hours
  const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T12:00:00`).getDay()];
  const h = l.opening_hours?.[key];
  if (h?.closed) return `${l.title} is closed on that day.`;
  if (h?.open && time && !['hotel', 'airbnb'].includes(l.category) && (toMin(time) < toMin(h.open) || toMin(time) > toMin(h.close))) return `${l.title} is open ${h.open} – ${h.close} on that day.`;
  return null;
}
