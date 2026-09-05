import { describe, expect, it } from 'vitest';
import type { CalendarConfig, SavedViewCatalog } from '../types';
import {
	preferredBoardGroupProperty,
	preferredCalendarWeekStart,
	suggestSavedViewName,
	writableBoardGroupProperties,
} from './saved-view-form';

function catalog(): SavedViewCatalog {
	return {
		source: 'canonical',
		canMutate: true,
		entries: [
			{
				kind: 'valid',
				definition: {
					id: 'calendar',
					name: 'Calendar view',
					type: 'calendar',
					layout: 'month',
					weekStartsOn: 'monday',
				},
			},
			{
				kind: 'valid',
				definition: {
					id: 'second',
					name: 'Calendar view 2',
					type: 'calendar',
					layout: 'week',
					weekStartsOn: 'sunday',
				},
			},
			{
				kind: 'unsupported',
				id: 'future',
				name: 'Board',
				viewType: 'timeline',
				raw: { id: 'future', name: 'Board', type: 'timeline' },
			},
		],
	};
}

function config(): CalendarConfig {
	return {
		documentPath: 'Work/_calendar.md',
		name: 'Work',
		sourceFolder: 'Work',
		recursive: true,
		startDateProperty: 'date',
		endDateProperty: 'date-end',
		visibleProperties: [],
		propertyDefinitions: {
			status: { type: 'select', options: ['None', 'Todo'] },
			type: { type: 'select', options: ['None', 'Task'] },
			date: { type: 'select', options: ['None', 'Soon'] },
			position: { type: 'select', options: ['None', 'First'] },
			owner: { type: 'text' },
		},
		viewCatalog: catalog(),
		layout: 'month',
		weekStartsOn: 'locale',
		openBehavior: 'same-leaf',
		createFolder: 'Work',
		excludePaths: [],
	};
}

describe('saved-view form defaults', () => {
	it('suggests the first unused type-specific name, including unavailable entries', () => {
		expect(suggestSavedViewName(catalog(), 'calendar')).toBe('Calendar view 3');
		expect(suggestSavedViewName(catalog(), 'board')).toBe('Board 2');
	});

	it('offers only writable Select properties and prefers status', () => {
		expect(writableBoardGroupProperties(config())).toEqual(['status', 'type']);
		expect(preferredBoardGroupProperty(config())).toBe('status');
	});

	it('copies week start from the active Calendar, then the first Calendar', () => {
		expect(preferredCalendarWeekStart(catalog(), 'second')).toBe('sunday');
		expect(preferredCalendarWeekStart(catalog(), 'missing')).toBe('monday');
		expect(
			preferredCalendarWeekStart(
				{ source: 'canonical', canMutate: true, entries: [] },
			),
		).toBe('locale');
	});
});
