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

		expect(original.visibleProperties).toEqual(['Status']);
		expect(original.excludePaths).toEqual(['Life/Work/Archive']);
		expect(original.propertyDefinitions.Status?.options).toEqual(['None', 'Done']);
		expect(original.propertyDefinitions.Status?.colors?.Done).toBe('green');
	});
});
