import { describe, expect, it } from 'vitest';
import type { CalendarConfig } from '../types';
import { projectCalendarFile, sortCalendarItems } from './projection';

const config: CalendarConfig = {
	documentPath: 'Calendars/Calendar/_calendar.md',
	name: 'Calendar',
	sourceFolder: '',
	recursive: true,
	startDateProperty: 'date',
	endDateProperty: 'date-end',
	visibleProperties: ['status'],
	propertyDefinitions: {},
	weekStartsOn: 'monday',
	layout: 'month',
	openBehavior: 'same-leaf',
	createFolder: '',
	excludePaths: [],
};

describe('calendar item projection', () => {
	it('projects schema defaults without mutating the event note', () => {
		const frontmatter = { title: 'Alpha', date: '2026-08-17' };
		const result = projectCalendarFile(
			{ path: 'Tasks/Alpha.md', basename: 'Alpha', mtime: 12, frontmatter },
			{
				...config,
				propertyDefinitions: {
					status: { type: 'select', options: ['Not started', 'Done'], default: 'Not started' },
				},
			},
		);

		expect(result.item?.properties.status).toBe('Not started');
		expect(frontmatter).not.toHaveProperty('status');
	});

	it('derives the event card color from the configured select property', () => {
		const result = projectCalendarFile(
			{
				path: 'Tasks/Done.md',
				basename: 'Done',
				mtime: 12,
				frontmatter: { title: 'Done', date: '2026-08-17', status: 'Done' },
			},
			{
				...config,
				cardColorProperty: 'status',
				propertyDefinitions: {
					status: {
						type: 'select',
						options: ['None', 'Not started', 'Done'],
						colors: { None: 'default', 'Not started': 'gray', Done: 'green' },
					},
				},
			},
		);

		expect(result.item?.color).toBe('green');
	});

	it('renders a deleted select option as None without mutating the event note', () => {
		const frontmatter = {
			title: 'Legacy status',
			date: '2026-08-17',
			status: 'Removed',
		};
		const result = projectCalendarFile(
			{ path: 'Tasks/Legacy.md', basename: 'Legacy status', mtime: 12, frontmatter },
			{
				...config,
				cardColorProperty: 'status',
				propertyDefinitions: {
					status: {
						type: 'select',
						options: ['None', 'Not started', 'Done'],
						colors: { None: 'default', 'Not started': 'gray', Done: 'green' },
					},
				},
			},
		);

		expect(result.item?.properties.status).toBe('None');
		expect(result.item?.color).toBe('default');
		expect(frontmatter.status).toBe('Removed');
	});

	it('uses the file path as identity and falls back to the filename only when title is absent', () => {
		const result = projectCalendarFile(
			{ path: 'Tasks/Alpha.md', basename: 'Alpha', mtime: 12, frontmatter: { date: '2026-08-17' } },
			config,
		);
		expect(result.item).toMatchObject({
			path: 'Tasks/Alpha.md',
			title: 'Alpha',
			start: '2026-08-17',
			mtime: 12,
		});

		const blank = projectCalendarFile(
			{
				path: 'Tasks/--7f3A.md',
				basename: '--7f3A',
				mtime: 13,
				frontmatter: { title: '   ', date: '2026-08-17' },
			},
			config,
		);
		expect(blank.item?.title).toBe('');
	});

	it('isolates missing, invalid, and reversed dates', () => {
		expect(
			projectCalendarFile(
				{ path: 'Missing.md', basename: 'Missing', mtime: 1, frontmatter: {} },
				config,
			).issue?.kind,
		).toBe('missing-date');
		expect(
			projectCalendarFile(
				{ path: 'Invalid.md', basename: 'Invalid', mtime: 1, frontmatter: { date: 'soon' } },
				config,
			).issue?.kind,
		).toBe('invalid-start');
		expect(
			projectCalendarFile(
				{
					path: 'Reversed.md',
					basename: 'Reversed',
					mtime: 1,
					frontmatter: { date: '2026-08-20', 'date-end': '2026-08-19' },
				},
				config,
			).issue?.kind,
		).toBe('end-before-start');
		expect(
			projectCalendarFile(
				{
					path: 'Reversed time.md',
					basename: 'Reversed time',
					mtime: 1,
					frontmatter: {
						date: '2026-08-20T10:00:00+08:00',
						'date-end': '2026-08-20T09:00:00+08:00',
					},
				},
				config,
			).issue?.kind,
		).toBe('end-before-start');
	});

	it('keeps same-title notes distinct and sorts by start, title, then path', () => {
		const items = [
			{ path: 'B.md', title: 'Same', start: '2026-08-18', startTimeSort: 0, allDay: true, properties: {}, mtime: 1, subItems: [] },
			{ path: 'Z.md', title: 'Same', start: '2026-08-17', startTimeSort: 0, allDay: true, properties: {}, mtime: 1, subItems: [] },
			{ path: 'A.md', title: 'Same', start: '2026-08-17', startTimeSort: 0, allDay: true, properties: {}, mtime: 1, subItems: [] },
		];
		expect(sortCalendarItems(items).map((item) => item.path)).toEqual(['A.md', 'Z.md', 'B.md']);
	});

	it('sorts an empty title by its visible New page label', () => {
		const items = [
			{ path: 'Zebra.md', title: 'Zebra', start: '2026-08-17', startTimeSort: 0, allDay: true, properties: {}, mtime: 1, subItems: [] },
			{ path: 'Untitled.md', title: '', start: '2026-08-17', startTimeSort: 0, allDay: true, properties: {}, mtime: 1, subItems: [] },
			{ path: 'Alpha.md', title: 'Alpha', start: '2026-08-17', startTimeSort: 0, allDay: true, properties: {}, mtime: 1, subItems: [] },
		];

		expect(sortCalendarItems(items).map((item) => item.path)).toEqual([
			'Alpha.md',
			'Untitled.md',
			'Zebra.md',
		]);
	});

	it('sorts ISO date-times by their authored start time before title and path', () => {
		const late = projectCalendarFile(
			{
				path: 'Early title.md',
				basename: 'Early title',
				mtime: 1,
				frontmatter: { title: 'A title', date: '2026-08-17T10:00:00+08:00' },
			},
			config,
		).item;
		const early = projectCalendarFile(
			{
				path: 'Late title.md',
				basename: 'Late title',
				mtime: 1,
				frontmatter: { title: 'Z title', date: '2026-08-17T09:00:00+08:00' },
			},
			config,
		).item;
		if (!late || !early) throw new Error('Expected projected items');

		expect(sortCalendarItems([late, early]).map((item) => item.path)).toEqual([
			'Late title.md',
			'Early title.md',
		]);
	});
});
