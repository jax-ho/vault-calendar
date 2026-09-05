import { describe, expect, it } from 'vitest';
import type { CalendarConfig } from '../types';
import { copyCalendarConfig } from './calendar-copy';

describe('calendar config copies', () => {
	it('copies every mutable schema and list value', () => {
		const original: CalendarConfig = {
			documentPath: 'Life/Work/_calendar.md',
			name: 'Work',
			sourceFolder: 'Life/Work',
			recursive: true,
			startDateProperty: 'date',
			visibleProperties: ['Status'],
			propertyDefinitions: {
				Status: {
					type: 'select',
					options: ['None', 'Done'],
					colors: { None: 'default', Done: 'green' },
					default: 'None',
				},
			},
			cardColorProperty: 'Status',
			viewCatalog: {
				source: 'canonical',
				canMutate: true,
				entries: [
					{
						kind: 'valid',
						definition: {
							id: 'calendar',
							name: 'Calendar',
							type: 'calendar',
							layout: 'month',
							weekStartsOn: 'monday',
						},
					},
					{
						kind: 'valid',
						definition: {
							id: 'board',
							name: 'Board',
							type: 'board',
							groupBy: 'Status',
						},
						warnings: [
							{ field: 'calendar-views[1].group-by', message: 'Example warning.' },
						],
					},
				],
			},
			weekStartsOn: 'monday',
			layout: 'month',
			openBehavior: 'same-leaf',
			createFolder: 'Life/Work',
			excludePaths: ['Life/Work/Archive'],
		};

		const copy = copyCalendarConfig(original);
		copy.visibleProperties.push('Type');
		copy.excludePaths.push('Life/Work/Drafts');
		copy.propertyDefinitions.Status?.options?.push('Blocked');
		if (copy.propertyDefinitions.Status?.colors) {
			copy.propertyDefinitions.Status.colors.Done = 'blue';
		}
		const copiedBoard = copy.viewCatalog?.entries[1];
		if (copiedBoard?.kind === 'valid') copiedBoard.definition.name = 'Renamed';
		if (copiedBoard?.kind === 'valid' && copiedBoard.warnings) {
			copiedBoard.warnings[0]!.message = 'Changed warning.';
		}

		expect(original.visibleProperties).toEqual(['Status']);
		expect(original.excludePaths).toEqual(['Life/Work/Archive']);
		expect(original.propertyDefinitions.Status?.options).toEqual(['None', 'Done']);
		expect(original.propertyDefinitions.Status?.colors?.Done).toBe('green');
		expect(original.viewCatalog?.entries[1]).toMatchObject({
			kind: 'valid',
			definition: { name: 'Board' },
			warnings: [{ message: 'Example warning.' }],
		});
	});

	it('copies raw unavailable entries without sharing nested objects', () => {
		const original = {
			source: 'canonical' as const,
			canMutate: false,
			entries: [
				{
					kind: 'unsupported' as const,
					id: 'timeline',
					viewType: 'timeline',
					raw: { id: 'timeline', type: 'timeline', settings: { zoom: 'year' } },
				},
			],
		};
		const config = {
			documentPath: 'Life/Work/_calendar.md',
			name: 'Work',
			sourceFolder: 'Life/Work',
			recursive: true,
			startDateProperty: 'date',
			visibleProperties: [],
			propertyDefinitions: {},
			viewCatalog: original,
			weekStartsOn: 'locale' as const,
			layout: 'month' as const,
			openBehavior: 'same-leaf' as const,
			createFolder: 'Life/Work',
			excludePaths: [],
		} satisfies CalendarConfig;

		const copy = copyCalendarConfig(config);
		const copiedEntry = copy.viewCatalog?.entries[0];
		if (copiedEntry?.kind !== 'unsupported') throw new Error('Expected unsupported view');
		(copiedEntry.raw as { settings: { zoom: string } }).settings.zoom = 'month';

		expect(
			(original.entries[0]?.raw as { settings: { zoom: string } }).settings.zoom,
		).toBe('year');
	});
});
