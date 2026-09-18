import type { SupportCaseState } from '../services/supportCases';

type FirestoreDate = { toDate(): Date };

function supportDate(value: number | Date | FirestoreDate | null | undefined): Date | undefined {
  return typeof value === 'number'
    ? new Date(value)
    : value instanceof Date
      ? value
      : value?.toDate();
}

export function formatSupportMessageTime(
  value: number | Date | FirestoreDate | null | undefined,
  locale: string,
): string {
  const date = supportDate(value);
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatSupportConversationTimestamp(
  value: number | Date | FirestoreDate | null | undefined,
  locale: string,
  yesterdayLabel: string,
  now = new Date(),
): string {
  const date = supportDate(value);
  if (!date || Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return '';
  const localDayNumber = (candidate: Date) => Date.UTC(
    candidate.getFullYear(),
    candidate.getMonth(),
    candidate.getDate(),
  ) / 86_400_000;
  const dayDifference = localDayNumber(now) - localDayNumber(date);
  const time = formatSupportMessageTime(date, locale);
  if (dayDifference === 0) return time;
  if (dayDifference === 1) return `${yesterdayLabel} · ${time}`;
  const calendarDate = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  }).format(date);
  return `${calendarDate} · ${time}`;
}

export function supportCaseStatusKind(state: SupportCaseState): 'open' | 'closed' {
  return state === 'SUBMITTED' || state === 'CHAT_OPEN' ? 'open' : 'closed';
}

export function hasUnreadSupportMessage(unreadByUserCount: number): boolean {
  return unreadByUserCount > 0;
}

function normalizedSupportSearch(value: string, locale: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase(locale)
    .trim();
}

export function matchesSupportCaseSearch(
  subject: string,
  lastMessage: string,
  query: string,
  locale: string,
): boolean {
  const normalizedQuery = normalizedSupportSearch(query, locale);
  if (!normalizedQuery) return true;
  return normalizedSupportSearch(`${subject} ${lastMessage}`, locale).includes(normalizedQuery);
}

export function supportComposerBottomPadding(bottomInset: number, basePadding: number): number {
  return Math.max(bottomInset, basePadding);
}
