import { describe, expect, it } from 'vitest';
import {
	addDays,
	addMonths,
	daysBetween,
	monthGrid,
	parseCalendarDate,
	startOfWeek,
	weekGrid,
} from './dates';

describe('calendar dates', () => {
	it('accepts plain dates, ISO date times, and valid YAML Date values', () => {
		expect(parseCalendarDate('2026-08-17')).toBe('2026-08-17');
		expect(parseCalendarDate('2026-08-17T23:15:00+08:00')).toBe('2026-08-17');
		expect(parseCalendarDate(new Date(2026, 7, 17, 12))).toBe('2026-08-17');
	});

	it('rejects invalid dates without normalizing them', () => {
		expect(parseCalendarDate('2026-02-30')).toBeUndefined();
		expect(parseCalendarDate('08/17/2026')).toBeUndefined();
		expect(parseCalendarDate('not a date')).toBeUndefined();
	});

	it('performs range arithmetic without daylight-saving drift', () => {
		expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
		expect(daysBetween('2026-03-08', '2026-03-10')).toBe(2);
		expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
	});

	it('builds the complete Monday-first month grid', () => {
		const dates = monthGrid('2026-08-17', 'monday');
		expect(dates).toHaveLength(42);
		expect(dates[0]).toBe('2026-07-27');
		expect(dates.at(-1)).toBe('2026-09-06');
	});

	it('builds Sunday-first and Monday-first weeks', () => {
		expect(startOfWeek('2026-08-20', 'monday')).toBe('2026-08-17');
		expect(weekGrid('2026-08-20', 'sunday')).toEqual([
			'2026-08-16',
			'2026-08-17',
			'2026-08-18',
			'2026-08-19',
			'2026-08-20',
			'2026-08-21',
			'2026-08-22',
		]);
	});
});
