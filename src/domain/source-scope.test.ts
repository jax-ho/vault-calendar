import { describe, expect, it } from 'vitest';
import type { CalendarConfig } from '../types';
import { isPathInCalendarSource } from './source-scope';

const config: CalendarConfig = {
	documentPath: 'Projects/Calendar/_calendar.md',
	name: 'Calendar',
	sourceFolder: 'Projects',
	recursive: true,
	startDateProperty: 'date',
	endDateProperty: 'date-end',
	visibleProperties: [],
	propertyDefinitions: {},
	weekStartsOn: 'monday',
	layout: 'month',
	openBehavior: 'same-leaf',
	createFolder: 'Projects',
	excludePaths: ['Projects/Archive'],
};

describe('calendar source scope', () => {
	it('includes Markdown notes recursively while excluding calendar documents by identity', () => {
		expect(isPathInCalendarSource('Projects/Task.md', config, '.config')).toBe(true);
		expect(isPathInCalendarSource('Projects/Nested/Task.md', config, '.config')).toBe(true);
		expect(
			isPathInCalendarSource('Projects/Calendar/_calendar.md', config, '.config'),
		).toBe(false);
		expect(isPathInCalendarSource('Projects/image.png', config, '.config')).toBe(false);
	});

	it('honors non-recursive and explicit exclusion rules', () => {
		expect(isPathInCalendarSource('Projects/Archive/Old.md', config, '.config')).toBe(false);
		expect(
			isPathInCalendarSource(
				'Projects/Nested/Task.md',
				{ ...config, recursive: false },
				'.config',
			),
		).toBe(false);
	});

	it('always excludes Obsidian and trash paths', () => {
		const rootConfig = { ...config, sourceFolder: '', documentPath: 'Calendar/_calendar.md' };
		expect(isPathInCalendarSource('.config/plugins/demo/data.md', rootConfig, '.config')).toBe(false);
		expect(isPathInCalendarSource('.trash/Deleted.md', rootConfig, '.config')).toBe(false);
		expect(isPathInCalendarSource('Trash/Deleted.md', rootConfig, '.config')).toBe(false);
	});
});
