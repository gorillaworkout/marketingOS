import { addDays, weekdayOf } from '@/lib/monthly-report/periods';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekRange(date: string): { from: string; to: string } {
  const from = addDays(date, 1 - weekdayOf(date));
  return { from, to: addDays(from, 6) };
}

/** Monday-first weeks covering the month, including the leading and trailing days. */
export function monthWeeks(year: number, month: number): string[][] {
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  let cursor = addDays(first, 1 - weekdayOf(first));
  const weeks: string[][] = [];
  do {
    const week: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  } while (cursor.slice(0, 7) === first.slice(0, 7));
  return weeks;
}

export function shiftMonth(yearMonth: string, direction: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1 + direction, 1));
  return cursor.toISOString().slice(0, 7);
}

export const monthName = (index: number) => SHORT[index];

export function isFutureDay(date: string, today: string): boolean {
  return date > today;
}

export function isFutureMonth(yearMonth: string, today: string): boolean {
  return yearMonth > today.slice(0, 7);
}
