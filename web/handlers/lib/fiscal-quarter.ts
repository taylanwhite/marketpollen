/**
 * Fiscal quarters are 13 Monday–Sunday weeks.
 * Q4 2026 starts Monday, September 28, 2026. Each later quarter
 * starts 91 days after the one before it, and earlier quarters
 * step backward by the same length.
 */

const ANCHOR_YEAR = 2026;
const ANCHOR_MONTH = 8;
const ANCHOR_DAY = 28;
const QUARTER_LENGTH_DAYS = 91;

export interface FiscalQuarter {
  year: number;
  quarter: number;
  start: Date;
  end: Date;
}

function localDayNumber(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month, day) / 86_400_000);
}

const ANCHOR_DAY_NUMBER = localDayNumber(ANCHOR_YEAR, ANCHOR_MONTH, ANCHOR_DAY);

function dateFromDayNumber(dayNumber: number, endOfDay = false): Date {
  const utc = new Date(dayNumber * 86_400_000);
  return new Date(
    utc.getUTCFullYear(),
    utc.getUTCMonth(),
    utc.getUTCDate(),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
}

export function getFiscalQuarter(date: Date = new Date()): FiscalQuarter {
  const day = localDayNumber(date.getFullYear(), date.getMonth(), date.getDate());
  const index = Math.floor((day - ANCHOR_DAY_NUMBER) / QUARTER_LENGTH_DAYS);
  const startDay = ANCHOR_DAY_NUMBER + index * QUARTER_LENGTH_DAYS;

  const quarterMod = ((index % 4) + 4) % 4;
  const quarter = quarterMod === 0 ? 4 : quarterMod;
  const year = ANCHOR_YEAR + (Math.ceil(index / 4) * 4) / 4;

  return {
    year,
    quarter,
    start: dateFromDayNumber(startDay),
    end: dateFromDayNumber(startDay + QUARTER_LENGTH_DAYS - 1, true),
  };
}

export function getQuarterDateRange(date: Date = new Date()): { start: Date; end: Date } {
  const { start, end } = getFiscalQuarter(date);
  return { start, end };
}

export function getCurrentQuarterLabel(date: Date = new Date()): string {
  const { quarter, year } = getFiscalQuarter(date);
  return `Q${quarter} ${year}`;
}
