import type { WeekStartsOn } from '../types';

export type PlainDate = string;

const PLAIN_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ISO_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|[+-]\d{2}:?\d{2})?$/u;

function pad(value: number): string {
	return value.toString().padStart(2, '0');
}

function dateFromParts(year: number, month: number, day: number): Date {
	return new Date(Date.UTC(year, month - 1, day));
}

export function isPlainDate(value: string): boolean {
	const match = PLAIN_DATE_PATTERN.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const parsed = dateFromParts(year, month, day);
	return (
		parsed.getUTCFullYear() === year &&
		parsed.getUTCMonth() === month - 1 &&
		parsed.getUTCDate() === day
	);
}

export function parseCalendarDate(value: unknown): PlainDate | undefined {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return undefined;
		return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
	}
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	if (isPlainDate(trimmed)) return trimmed;
	const isoMatch = ISO_DATE_TIME_PATTERN.exec(trimmed);
	if (!isoMatch || Number.isNaN(Date.parse(trimmed))) return undefined;
	const datePart = isoMatch[1];
	return datePart && isPlainDate(datePart) ? datePart : undefined;
}

export function calendarStartTimeSort(value: unknown): number | undefined {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return undefined;
		return (
			value.getHours() * 3_600 +
			value.getMinutes() * 60 +
			value.getSeconds() +
			value.getMilliseconds() / 1_000
		);
	}
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	if (isPlainDate(trimmed)) return 0;
	const match = ISO_DATE_TIME_PATTERN.exec(trimmed);
	if (!match || Number.isNaN(Date.parse(trimmed))) return undefined;
	const hours = Number(match[2]);
	const minutes = Number(match[3]);
	const seconds = Number(match[4] ?? 0);
	const fractional = Number(`0.${match[5] ?? '0'}`);
	return hours * 3_600 + minutes * 60 + seconds + fractional;
}

export function toUtcDate(date: PlainDate): Date {
	const match = PLAIN_DATE_PATTERN.exec(date);
	if (!match || !isPlainDate(date)) throw new Error(`Invalid calendar date: ${date}`);
	return dateFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function fromUtcDate(date: Date): PlainDate {
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function todayPlainDate(now = new Date()): PlainDate {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function addDays(date: PlainDate, amount: number): PlainDate {
	const result = toUtcDate(date);
	result.setUTCDate(result.getUTCDate() + amount);
	return fromUtcDate(result);
}

export function addMonths(date: PlainDate, amount: number): PlainDate {
	const original = toUtcDate(date);
	const target = new Date(Date.UTC(original.getUTCFullYear(), original.getUTCMonth() + amount, 1));
	const lastDay = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
	).getUTCDate();
	target.setUTCDate(Math.min(original.getUTCDate(), lastDay));
	return fromUtcDate(target);
}

export function compareDates(left: PlainDate, right: PlainDate): number {
	return left.localeCompare(right);
}

export function daysBetween(start: PlainDate, end: PlainDate): number {
	return Math.round((toUtcDate(end).getTime() - toUtcDate(start).getTime()) / 86_400_000);
}

export function inclusiveDayCount(start: PlainDate, end: PlainDate): number {
	return daysBetween(start, end) + 1;
}

export type ResolvedWeekStart = 'monday' | 'sunday';

interface LocaleWithWeekInfo extends Intl.Locale {
	getWeekInfo?: () => { firstDay: number };
	weekInfo?: { firstDay: number };
}

export function resolveWeekStart(
	preference: WeekStartsOn,
	locale = typeof navigator === 'undefined' ? 'en-US' : navigator.language,
): ResolvedWeekStart {
	if (preference !== 'locale') return preference;
	try {
		const localeObject = new Intl.Locale(locale) as LocaleWithWeekInfo;
		const firstDay = localeObject.getWeekInfo?.().firstDay ?? localeObject.weekInfo?.firstDay;
		if (firstDay !== undefined) return firstDay === 7 ? 'sunday' : 'monday';
	} catch {
		// Fall through to the conservative locale heuristic below.
	}
	const sundayFirstRegions = /(?:^|[-_])(US|CA|PH|JP|TW|HK)(?:$|[-_])/iu;
	return sundayFirstRegions.test(locale) ? 'sunday' : 'monday';
}

export function startOfWeek(
	date: PlainDate,
	weekStart: ResolvedWeekStart,
): PlainDate {
	const parsed = toUtcDate(date);
	const weekday = parsed.getUTCDay();
	const offset = weekStart === 'sunday' ? weekday : (weekday + 6) % 7;
	return addDays(date, -offset);
}

export function endOfWeek(
	date: PlainDate,
	weekStart: ResolvedWeekStart,
): PlainDate {
	return addDays(startOfWeek(date, weekStart), 6);
}

export function monthGrid(
	focusDate: PlainDate,
	weekStart: ResolvedWeekStart,
): PlainDate[] {
	const parsed = toUtcDate(focusDate);
	const firstOfMonth = fromUtcDate(
		new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1)),
	);
	const lastOfMonth = fromUtcDate(
		new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)),
	);
	return dateRange(
		startOfWeek(firstOfMonth, weekStart),
		endOfWeek(lastOfMonth, weekStart),
	);
}

export function weekGrid(
	focusDate: PlainDate,
	weekStart: ResolvedWeekStart,
): PlainDate[] {
	const first = startOfWeek(focusDate, weekStart);
	return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

export function dateRange(start: PlainDate, end: PlainDate): PlainDate[] {
	const count = inclusiveDayCount(start, end);
	if (count < 1) return [];
	return Array.from({ length: count }, (_, index) => addDays(start, index));
}

export function clampDate(
	date: PlainDate,
	minimum: PlainDate,
	maximum: PlainDate,
): PlainDate {
	if (compareDates(date, minimum) < 0) return minimum;
	if (compareDates(date, maximum) > 0) return maximum;
	return date;
}

export function sameMonth(left: PlainDate, right: PlainDate): boolean {
	return left.slice(0, 7) === right.slice(0, 7);
}
