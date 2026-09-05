import type {
	CalendarConfig,
	CalendarItem,
	ProjectionIssue,
} from '../types';
import {
	calendarStartTimeSort,
	compareDates,
	parseCalendarDate,
} from './dates';
import { calendarCardColor } from './calendar-colors';
import { eventDisplayTitle } from './event-title';
import { resolvedPropertyValue } from './property-values';
import { EVENT_TITLE_PROPERTY } from './reserved-properties';

export interface CalendarFileProjectionInput {
	path: string;
	basename: string;
	mtime: number;
	frontmatter?: Record<string, unknown>;
}

export type CalendarProjectionResult =
	| { item: CalendarItem; issue?: never }
	| { item?: never; issue: ProjectionIssue };

function issue(
	path: string,
	kind: ProjectionIssue['kind'],
	message: string,
): CalendarProjectionResult {
	return { issue: { path, kind, message } };
}

export function calendarItemTitle(value: unknown, fallback: string): string {
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number') return String(value);
	return fallback;
}

function copyProperties(
	frontmatter: Record<string, unknown>,
	config: CalendarConfig,
): Record<string, unknown> {
	const properties = Object.fromEntries(
		Object.entries(frontmatter).filter(([key]) => key !== 'position'),
	);
	for (const [property, definition] of Object.entries(config.propertyDefinitions)) {
		const value = resolvedPropertyValue(definition, properties[property]);
		if (value !== undefined) properties[property] = value;
	}
	return properties;
}

export function projectCalendarFile(
	file: CalendarFileProjectionInput,
	config: CalendarConfig,
): CalendarProjectionResult {
	if (!file.frontmatter) {
		return issue(
			file.path,
			'metadata-unavailable',
			'Metadata is not available for this note yet.',
		);
	}
	const rawStart = file.frontmatter[config.startDateProperty];
	if (rawStart === undefined || rawStart === null || rawStart === '') {
		return issue(
			file.path,
			'missing-date',
			`Missing ${config.startDateProperty}.`,
		);
	}
	const start = parseCalendarDate(rawStart);
	if (!start) {
		return issue(
			file.path,
			'invalid-start',
			`${config.startDateProperty} is not a supported date.`,
		);
	}
	const startTimeSort = calendarStartTimeSort(rawStart) ?? 0;

	let end: string | undefined;
	if (config.endDateProperty) {
		const rawEnd = file.frontmatter[config.endDateProperty];
		if (rawEnd !== undefined && rawEnd !== null && rawEnd !== '') {
			end = parseCalendarDate(rawEnd);
			if (!end) {
				return issue(
					file.path,
					'invalid-end',
					`${config.endDateProperty} is not a supported date.`,
				);
			}
			if (compareDates(end, start) < 0) {
				return issue(
					file.path,
					'end-before-start',
					`${config.endDateProperty} is earlier than ${config.startDateProperty}.`,
				);
			}
			if (
				end === start &&
				(calendarStartTimeSort(rawEnd) ?? 0) < startTimeSort
			) {
				return issue(
					file.path,
					'end-before-start',
					`${config.endDateProperty} is earlier than ${config.startDateProperty}.`,
				);
			}
		}
	}

	const properties = copyProperties(file.frontmatter, config);
	const item: CalendarItem = {
		path: file.path,
		title: calendarItemTitle(file.frontmatter[EVENT_TITLE_PROPERTY], file.basename),
		start,
		startTimeSort,
		allDay: true,
		properties,
		color: calendarCardColor(config, properties),
		mtime: file.mtime,
		subItems: [],
	};
	if (end && end !== start) item.end = end;
	return { item };
}

export function compareCalendarItems(left: CalendarItem, right: CalendarItem): number {
	const dateOrder = compareDates(left.start, right.start);
	if (dateOrder !== 0) return dateOrder;
	if (left.startTimeSort !== right.startTimeSort) {
		return left.startTimeSort - right.startTimeSort;
	}
	const titleOrder = eventDisplayTitle(left.title).localeCompare(
		eventDisplayTitle(right.title),
		undefined,
		{
			sensitivity: 'base',
			numeric: true,
		},
	);
	if (titleOrder !== 0) return titleOrder;
	return left.path.localeCompare(right.path, undefined, {
		sensitivity: 'base',
		numeric: true,
	});
}

export function sortCalendarItems(items: CalendarItem[]): CalendarItem[] {
	return [...items].sort(compareCalendarItems);
}
