import { describe, expect, it } from 'vitest';
import { dateRange } from './dates';
import { segmentCalendarItems, visibleTrackCount } from './range-layout';
import type { CalendarItem } from '../types';

function item(path: string, start: string, end?: string): CalendarItem {
	const result: CalendarItem = {
		path,
		title: path,
		start,
		startTimeSort: 0,
		allDay: true,
		properties: {},
		mtime: 1,
		subItems: [],
	};
	if (end) result.end = end;
	return result;
}

describe('calendar range layout', () => {
	it('projects single-day and multi-day events', () => {
		const dates = dateRange('2026-08-03', '2026-08-09');
		const segments = segmentCalendarItems(
			[item('One.md', '2026-08-05'), item('Range.md', '2026-08-06', '2026-08-08')],
			dates,
		);
		expect(segments.map((segment) => [segment.item.path, segment.startColumn, segment.span])).toEqual([
			['One.md', 2, 1],
			['Range.md', 3, 3],
		]);
	});

	it('splits cross-week ranges into visually continuous segments', () => {
		const dates = dateRange('2026-08-03', '2026-08-16');
		const segments = segmentCalendarItems(
			[item('Range.md', '2026-08-07', '2026-08-11')],
			dates,
		);
		expect(segments).toHaveLength(2);
		expect(segments[0]).toMatchObject({
			weekIndex: 0,
			startColumn: 4,
			span: 3,
			continuesAfter: true,
		});
		expect(segments[1]).toMatchObject({
			weekIndex: 1,
			startColumn: 0,
			span: 2,
			continuesBefore: true,
		});
	});

	it('assigns stable tracks', () => {
		const dates = dateRange('2026-08-03', '2026-08-09');
		const segments = segmentCalendarItems(
			[item('A.md', '2026-08-05'), item('B.md', '2026-08-05'), item('C.md', '2026-08-05')],
			dates,
		);
		expect(segments.map((segment) => segment.track)).toEqual([0, 1, 2]);
		expect(visibleTrackCount(segments, 0)).toBe(3);
		expect(visibleTrackCount(segments, 1)).toBe(0);
	});

	it('keeps every event track visible so the week row can expand', () => {
		const dates = dateRange('2026-08-03', '2026-08-09');
		const segments = segmentCalendarItems(
			[
				item('A.md', '2026-08-05'),
				item('B.md', '2026-08-05'),
				item('C.md', '2026-08-05'),
				item('D.md', '2026-08-05'),
			],
			dates,
		);
		expect(visibleTrackCount(segments, 0)).toBe(4);
	});
});
