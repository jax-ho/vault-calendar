import { addDays, compareDates, daysBetween, type PlainDate } from './dates';

export interface DateRange {
	start: PlainDate;
	end?: PlainDate;
}

export type ResizeEdge = 'start' | 'end';

export function moveDateRange(
	start: PlainDate,
	end: PlainDate | undefined,
	targetStart: PlainDate,
): DateRange {
	const duration = daysBetween(start, end ?? start);
	const next: DateRange = { start: targetStart };
	if (duration > 0) next.end = addDays(targetStart, duration);
	return next;
}

export function resizeDateRange(
	start: PlainDate,
	end: PlainDate | undefined,
	edge: ResizeEdge,
	targetDate: PlainDate,
): DateRange {
	const currentEnd = end ?? start;
	if (edge === 'start') {
		if (compareDates(targetDate, currentEnd) > 0) {
			throw new Error('The start date cannot be later than the end date.');
		}
		return targetDate === currentEnd
			? { start: targetDate }
			: { start: targetDate, end: currentEnd };
	}
	if (compareDates(targetDate, start) < 0) {
		throw new Error('The end date cannot be earlier than the start date.');
	}
	return targetDate === start ? { start } : { start, end: targetDate };
}
