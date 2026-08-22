import type { DateRange } from './interactions';

export interface DateFieldMapping {
	startProperty: string;
	endProperty?: string;
}

export function replaceCalendarDatePart(originalValue: unknown, nextDate: string): unknown {
	if (
		typeof originalValue === 'string' &&
		/^\d{4}-\d{2}-\d{2}T/u.test(originalValue)
	) {
		return `${nextDate}${originalValue.slice(10)}`;
	}
	if (originalValue instanceof Date && !Number.isNaN(originalValue.getTime())) {
		const [year, month, day] = nextDate.split('-').map(Number);
		const updated = new Date(originalValue.getTime());
		if (year !== undefined && month !== undefined && day !== undefined) {
			updated.setFullYear(year, month - 1, day);
		}
		return updated;
	}
	return nextDate;
}

export function applyDateRangeMutation(
	frontmatter: Record<string, unknown>,
	mapping: DateFieldMapping,
	nextRange: DateRange,
): void {
	if (nextRange.end && nextRange.end !== nextRange.start && !mapping.endProperty) {
		throw new Error('Configure an end date property before creating a date range.');
	}
	const originalStart = frontmatter[mapping.startProperty];
	frontmatter[mapping.startProperty] = replaceCalendarDatePart(
		originalStart,
		nextRange.start,
	);
	if (!mapping.endProperty) return;
	if (nextRange.end && nextRange.end !== nextRange.start) {
		frontmatter[mapping.endProperty] = replaceCalendarDatePart(
			frontmatter[mapping.endProperty] ?? originalStart,
			nextRange.end,
		);
	} else {
		delete frontmatter[mapping.endProperty];
	}
}
