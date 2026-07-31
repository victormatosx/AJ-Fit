import { useState } from 'react';
import { parseDateParts } from '../lib/dateUtils';

/**
 * Day/month/year text-field state for a date picker, shared by every screen
 * that needs one (onboarding birth date, retroactive assessment date). Each
 * caller layers its own semantics (future-date checks, age bounds, etc.) on
 * top of the parsed `date`.
 */
export function useDateParts(initial?: Date) {
  const base = initial ?? new Date();
  const [day, setDay] = useState(String(base.getDate()));
  const [month, setMonth] = useState(String(base.getMonth() + 1));
  const [year, setYear] = useState(String(base.getFullYear()));

  const date = parseDateParts(parseInt(day, 10), parseInt(month, 10), parseInt(year, 10));

  return { day, setDay, month, setMonth, year, setYear, date };
}
