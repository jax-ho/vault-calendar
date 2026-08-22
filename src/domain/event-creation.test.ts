import { describe, expect, it } from 'vitest';
import type { CalendarConfig } from '../types';
import { createEventPropertyDraft } from './event-creation';

function calendarConfig(): CalendarConfig {
	return {
		documentPath: 'Life/Work/_calendar.md',
		name: 'Work',
		sourceFolder: 'Life/Work',
		recursive: true,
		startDateProperty: 'date',
		endDateProperty: 'date-end',
		visibleProperties: ['status', 'type', 'important'],
		propertyDefinitions: {
			status: {
				type: 'select',
				options: ['None', 'Not started', 'Done'],
				default: 'Not started',
			},
			type: { type: 'select', options: ['Task', 'Idea'] },
			important: { type: 'checkbox' },
			estimate: { type: 'number', default: 2 },
			notes: { type: 'text' },
			title: { type: 'text', default: 'Reserved' },
			date: { type: 'text', default: 'Reserved' },
			'date-end': { type: 'text', default: 'Reserved' },
		},
		weekStartsOn: 'monday',
		layout: 'month',
		openBehavior: 'same-leaf',
		createFolder: 'Life/Work',
		excludePaths: [],
	};
}

describe('event creation property draft', () => {
	it('uses configured defaults and concrete empty values for selects and checkboxes', () => {
		expect(createEventPropertyDraft(calendarConfig())).toEqual({
			status: 'Not started',
			type: 'None',
			important: false,
			estimate: 2,
			notes: undefined,
		});
	});
});
