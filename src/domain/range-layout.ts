import type { CalendarItem } from '../types';
import {
	addDays,
	clampDate,
	compareDates,
	daysBetween,
	type PlainDate,
} from './dates';
import { eventDisplayTitle } from './event-title';
import { sortCalendarItems } from './projection';

export interface CalendarSegment {
	item: CalendarItem;
	weekIndex: number;
	startDate: PlainDate;
	endDate: PlainDate;
	startColumn: number;
	span: number;
	continuesBefore: boolean;
	continuesAfter: boolean;
	track: number;
}

function assignTracks(segments: CalendarSegment[]): void {
	const tracksByWeek = new Map<number, boolean[][]>();
	for (const segment of segments) {
		const tracks = tracksByWeek.get(segment.weekIndex) ?? [];
		let track = 0;
		while (tracks[track]?.slice(segment.startColumn, segment.startColumn + segment.span).some(Boolean)) {
			track += 1;
		}
		if (!tracks[track]) tracks[track] = Array.from({ length: 7 }, () => false);
		const targetTrack = tracks[track];
		if (!targetTrack) continue;
		for (
			let column = segment.startColumn;
			column < segment.startColumn + segment.span;
			column += 1
		) {
			targetTrack[column] = true;
		}
		segment.track = track;
		tracksByWeek.set(segment.weekIndex, tracks);
	}
}

export function segmentCalendarItems(
	items: CalendarItem[],
	visibleDates: PlainDate[],
): CalendarSegment[] {
	const visibleStart = visibleDates[0];
	const visibleEnd = visibleDates.at(-1);
	if (!visibleStart || !visibleEnd || visibleDates.length % 7 !== 0) return [];

	const segments: CalendarSegment[] = [];
	for (const item of sortCalendarItems(items)) {
		const itemEnd = item.end ?? item.start;
		if (compareDates(itemEnd, visibleStart) < 0 || compareDates(item.start, visibleEnd) > 0) {
			continue;
		}
		let cursor = clampDate(item.start, visibleStart, visibleEnd);
		const clippedEnd = clampDate(itemEnd, visibleStart, visibleEnd);
		while (compareDates(cursor, clippedEnd) <= 0) {
			const offset = daysBetween(visibleStart, cursor);
			const weekIndex = Math.floor(offset / 7);
			const startColumn = offset % 7;
			const weekEnd = addDays(visibleStart, weekIndex * 7 + 6);
			const segmentEnd =
				compareDates(clippedEnd, weekEnd) < 0 ? clippedEnd : weekEnd;
			segments.push({
				item,
				weekIndex,
				startDate: cursor,
				endDate: segmentEnd,
				startColumn,
				span: daysBetween(cursor, segmentEnd) + 1,
				continuesBefore: compareDates(cursor, item.start) > 0,
				continuesAfter: compareDates(segmentEnd, itemEnd) < 0,
				track: 0,
			});
			cursor = addDays(segmentEnd, 1);
		}
	}

	segments.sort((left, right) => {
		if (left.weekIndex !== right.weekIndex) return left.weekIndex - right.weekIndex;
		if (left.startColumn !== right.startColumn) return left.startColumn - right.startColumn;
		if (left.span !== right.span) return right.span - left.span;
		const titleOrder = eventDisplayTitle(left.item.title).localeCompare(
			eventDisplayTitle(right.item.title),
			undefined,
			{
				sensitivity: 'base',
				numeric: true,
			},
		);
		if (titleOrder !== 0) return titleOrder;
		return left.item.path.localeCompare(right.item.path);
	});
	assignTracks(segments);
	return segments;
}

export function visibleTrackCount(
	segments: CalendarSegment[],
	weekIndex: number,
): number {
	let count = 0;
	for (const segment of segments) {
		if (segment.weekIndex !== weekIndex) continue;
		count = Math.max(count, segment.track + 1);
	}
	return count;
}
