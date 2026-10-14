/** YYYY-MM-DD for a date in the shop's (browser's) time zone. */
export function localDate(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "2026-10-14" → "14 Oct 2026" (or a shorter form). */
export function formatDay(
  date: string,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
) {
  return new Date(`${date.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, opts);
}

export interface DateRange {
  from: string;
  to: string;
}

export const RANGE_PRESETS: { id: string; label: string; range: () => DateRange }[] = [
  { id: 'today', label: 'Today', range: () => ({ from: localDate(), to: localDate() }) },
  {
    id: 'yesterday',
    label: 'Yesterday',
    range: () => {
      const y = addDays(localDate(), -1);
      return { from: y, to: y };
    },
  },
  {
    id: 'week',
    label: 'This week',
    range: () => {
      const t = localDate();
      const dow = (new Date(`${t}T00:00:00Z`).getUTCDay() + 6) % 7;
      return { from: addDays(t, -dow), to: t };
    },
  },
  {
    id: '7d',
    label: 'Last 7 days',
    range: () => ({ from: addDays(localDate(), -6), to: localDate() }),
  },
  {
    id: 'month',
    label: 'This month',
    range: () => ({ from: `${localDate().slice(0, 7)}-01`, to: localDate() }),
  },
  {
    id: 'lastMonth',
    label: 'Last month',
    range: () => {
      const first = `${localDate().slice(0, 7)}-01`;
      const end = addDays(first, -1);
      return { from: `${end.slice(0, 7)}-01`, to: end };
    },
  },
  {
    id: '30d',
    label: 'Last 30 days',
    range: () => ({ from: addDays(localDate(), -29), to: localDate() }),
  },
  {
    id: 'year',
    label: 'This year',
    range: () => ({ from: `${localDate().slice(0, 4)}-01-01`, to: localDate() }),
  },
];
