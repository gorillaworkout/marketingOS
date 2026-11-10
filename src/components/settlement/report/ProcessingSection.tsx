import { Fragment } from 'react';
import { formatDurationShort } from '@/lib/settlement/format';
import type { ProcessingTime, TimeCell } from '@/lib/settlement/metrics';
import { GroupHeader, NumTd, Td, Th, tableClass } from './ReportTable';
import { ReportSectionHeader } from './ReportSectionHeader';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function label(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[day.getUTCDay()]} ${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

function CellView({ cell }: { cell: TimeCell | undefined }) {
  if (!cell || cell.hits === 0 || cell.avgSeconds === null) return <><span>—</span></>;
  return <><span>{formatDurationShort(cell.avgSeconds)}</span><span className="block text-[10.5px] text-[var(--mos-text-faint)]">{cell.hits} req</span></>;
}

function mean(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

export function ProcessingSection({ processing, variant }: { processing: ProcessingTime; variant: 'screen' | 'print' }) {
  const withdrawals = new Map(processing.withdrawals.map(row => [row.date, row]));
  const dates = [...new Set([...processing.deposits.map(row => row.date), ...processing.withdrawals.map(row => row.date)])].sort();
  const weeks = new Map<string, string[]>();
  for (const date of dates) {
    const day = new Date(`${date}T00:00:00Z`);
    const monday = new Date(day);
    monday.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    weeks.set(key, [...(weeks.get(key) ?? []), date]);
  }
  const deposits = new Map(processing.deposits.map(row => [row.date, row]));
  return (
    <section className="rounded-[var(--mos-radius-panel)] border border-[var(--mos-border)] bg-[var(--mos-panel)]">
      <div className="px-5 pt-4">
        <ReportSectionHeader id="processing" number="02" title="Processing time by day" description="Average time, with request count below. Weekly rows are the mean of daily office-hour averages." />
      </div>
      <div className={variant === 'print' ? 'overflow-x-auto' : 'max-h-[360px] overflow-auto'}>
        <table className={tableClass}>
          <caption className="sr-only">Processing time</caption>
          <thead>
            <tr>
              <GroupHeader span={1} align="left">Date</GroupHeader>
              <GroupHeader span={2}>Deposit · office hour</GroupHeader>
              <GroupHeader span={2}>Deposit · after office</GroupHeader>
              <GroupHeader span={2}>Withdrawal</GroupHeader>
            </tr>
            <tr>
              <Th />
              <Th align="right">API</Th><Th align="right">Manual</Th>
              <Th align="right">API</Th><Th align="right">Manual</Th>
              <Th align="right">Office hour</Th><Th align="right">2nd withdrawal</Th>
            </tr>
          </thead>
          <tbody>
            {[...weeks.entries()].map(([week, days]) => {
              const weekOffice = mean(days.map(date => {
                const row = deposits.get(date);
                const values = [row?.officeApi, row?.officeManual].filter(cell => cell && cell.hits > 0).map(cell => cell!.avgSeconds as number);
                return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
              }));
              return (
                <Fragment key={week}>
                  {days.map(date => {
                    const deposit = deposits.get(date);
                    const withdrawal = withdrawals.get(date);
                    return (
                      <tr key={date}>
                        <Td scope="row">{label(date)}</Td>
                        <NumTd><CellView cell={deposit?.officeApi} /></NumTd>
                        <NumTd><CellView cell={deposit?.officeManual} /></NumTd>
                        <NumTd><CellView cell={deposit?.afterApi} /></NumTd>
                        <NumTd><CellView cell={deposit?.afterManual} /></NumTd>
                        <NumTd><CellView cell={withdrawal?.office} /></NumTd>
                        <NumTd><CellView cell={withdrawal?.secondWithdrawal} /></NumTd>
                      </tr>
                    );
                  })}
                  <tr className="bg-[#2EB5C4]/5 font-[560] text-[var(--mos-text)]">
                    <Td>Week of {label(week)}</Td>
                    <NumTd>{formatDurationShort(weekOffice)}</NumTd>
                    <NumTd /><NumTd /><NumTd /><NumTd /><NumTd />
                  </tr>
                </Fragment>
              );
            })}
            <tr className="bg-[var(--mos-raised)] font-semibold text-[var(--mos-text)]">
              <Td>Period average</Td>
              <NumTd>{formatDurationShort(processing.summary.deposit)}</NumTd>
              <NumTd /><NumTd /><NumTd />
              <NumTd>{formatDurationShort(processing.summary.withdrawal)}</NumTd>
              <NumTd />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
