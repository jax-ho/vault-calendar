import { describe, expect, it } from 'vitest';
import {
	applyCalendarConfigToFrontmatter,
	applyCalendarConfigWithSavedViewsToFrontmatter,
	isCalendarDocumentPath,
	parseCalendarConfig,
} from './config';

describe('calendar document configuration', () => {
	it('parses defaults and derives identity and scope from the calendar folder', () => {
		const result = parseCalendarConfig('Life/Work/_calendar.md', {
			'calendar-view': true,
		});

		expect(result.issues).toEqual([]);
		expect(result.config).toMatchObject({
			documentPath: 'Life/Work/_calendar.md',
			name: 'Work',
			sourceFolder: 'Life/Work',
			recursive: true,
			startDateProperty: 'date',
			endDateProperty: 'date-end',
			visibleProperties: ['status', 'type'],
			propertyDefinitions: {
				status: {
					type: 'select',
					options: ['None', 'Not started', 'Blocked', 'In progress', 'Abandoned', 'Done'],
					colors: {
						None: 'default',
						'Not started': 'gray',
						Blocked: 'red',
						'In progress': 'blue',
						Abandoned: 'yellow',
						Done: 'green',
					},
					default: 'Not started',
				},
				type: {
					type: 'select',
					options: ['None', 'Task', 'Learn', 'Idea'],
					colors: { None: 'default', Task: 'blue', Learn: 'green', Idea: 'purple' },
					default: 'Task',
				},
			},
			cardColorProperty: 'status',
			viewCatalog: {
				source: 'legacy',
				canMutate: true,
				entries: [
					{
						kind: 'valid',
						definition: {
							id: 'calendar',
							name: 'Calendar view',
							type: 'calendar',
							layout: 'month',
							weekStartsOn: 'locale',
						},
					},
				],
			},
			weekStartsOn: 'locale',
			layout: 'month',
			createFolder: 'Life/Work',
		});
	});

	it('parses an extensible per-calendar property schema', () => {
		const result = parseCalendarConfig('Life/Work/_calendar.md', {
			'calendar-view': true,
			'calendar-properties': {
				stage: { type: 'select', options: ['Planned', 'Doing', 'Done'], default: 'Planned' },
				billable: { type: 'checkbox', default: true },
				effort: { type: 'number', default: 1 },
				owner: { type: 'text', default: 'Unassigned' },
			},
		});

		expect(result.issues).toEqual([]);
		expect(result.config?.propertyDefinitions).toEqual({
			stage: {
				type: 'select',
				options: ['None', 'Planned', 'Doing', 'Done'],
				colors: { None: 'default', Planned: 'default', Doing: 'default', Done: 'default' },
				default: 'Planned',
			},
			billable: { type: 'checkbox', default: true },
			effort: { type: 'number', default: 1 },
			owner: { type: 'text', default: 'Unassigned' },
		});
	});

	it('parses Notion-style option colors and links card color to a select property', () => {
		const result = parseCalendarConfig('Life/Work/_calendar.md', {
			'calendar-view': true,
			'calendar-card-color-property': 'stage',
			'calendar-properties': {
				stage: {
					type: 'select',
					options: ['Planned', 'Doing', 'Done'],
					colors: { None: 'default', Planned: 'gray', Doing: 'blue', Done: 'green' },
					default: 'Planned',
				},
			},
		});

		expect(result.issues).toEqual([]);
		expect(result.config?.cardColorProperty).toBe('stage');
		expect(result.config?.propertyDefinitions.stage?.colors).toEqual({
			None: 'default',
			Planned: 'gray',
			Doing: 'blue',
			Done: 'green',
		});
	});

	it('rejects unknown option colors and non-select card color properties', () => {
		const result = parseCalendarConfig('Life/Bad/_calendar.md', {
			'calendar-view': true,
			'calendar-card-color-property': 'important',
			'calendar-properties': {
				status: {
					type: 'select',
					options: ['Done'],
					colors: { Done: 'teal' },
				},
				important: { type: 'checkbox' },
			},
		});

		expect(result.config).toBeUndefined();
		expect(result.issues.map((issue) => issue.field)).toEqual([
			'calendar-properties.status.colors.Done',
			'calendar-card-color-property',
		]);
	});

	it('rejects malformed property schemas instead of guessing controls', () => {
		const result = parseCalendarConfig('Life/Bad/_calendar.md', {
			'calendar-view': true,
			'calendar-properties': {
				stage: { type: 'select' },
				owner: { type: 'person' },
				billable: { type: 'checkbox', default: 'yes' },
				effort: { type: 'number', default: 'many' },
				priority: { type: 'select', options: ['High', 'Low'], default: 'Medium' },
			},
		});

		expect(result.config).toBeUndefined();
		expect(result.issues.map((issue) => issue.field)).toEqual([
			'calendar-properties.stage.options',
			'calendar-properties.owner.type',
			'calendar-properties.billable.default',
			'calendar-properties.effort.default',
			'calendar-properties.priority.default',
		]);
	});

	it('parses independent named calendar configurations', () => {
		const work = parseCalendarConfig('Projects/Work/_calendar.md', {
			'calendar-view': true,
			title: 'Work calendar',
			'calendar-start-property': 'due',
		});
		const learning = parseCalendarConfig('Learning/_calendar.md', {
			'calendar-view': true,
			title: 'Learning calendar',
			'calendar-start-property': 'studied-on',
		});

		expect(work.config?.sourceFolder).toBe('Projects/Work');
		expect(learning.config?.sourceFolder).toBe('Learning');
		expect(work.config?.startDateProperty).not.toBe(learning.config?.startDateProperty);
	});

	it('isolates invalid fields instead of silently correcting them', () => {
		const result = parseCalendarConfig('Life/Bad/_calendar.md', {
			'calendar-view': true,
			'calendar-layout': 'timeline',
			'calendar-recursive': 'yes',
		});

		expect(result.isCalendarDocument).toBe(true);
		expect(result.config).toBeUndefined();
		expect(result.issues.map((item) => item.field)).toEqual(
			expect.arrayContaining(['calendar-layout', 'calendar-recursive']),
		);
	});

	it('keeps shared config usable when only a saved view is invalid', () => {
		const result = parseCalendarConfig('Life/Bad/_calendar.md', {
			'calendar-view': true,
			'calendar-layout': 'timeline',
		});

		expect(result.config).toBeDefined();
		expect(result.config?.viewCatalog).toMatchObject({
			source: 'legacy',
			canMutate: true,
			entries: [{ kind: 'invalid', id: 'calendar' }],
		});
		expect(result.issues.map((issue) => issue.field)).toEqual(['calendar-layout']);
	});

	it('parses canonical views and derives the compatibility facade from the first Calendar', () => {
		const result = parseCalendarConfig('Life/Work/_calendar.md', {
			'calendar-view': true,
			'calendar-views-version': 1,
			'calendar-views': [
				{ id: 'board', name: 'Board', type: 'board', 'group-by': 'status' },
				{
					id: 'week',
					name: 'Week',
					type: 'calendar',
					layout: 'week',
					'week-starts-on': 'sunday',
				},
			],
		});

		expect(result.issues).toEqual([]);
		expect(result.config?.layout).toBe('week');
		expect(result.config?.weekStartsOn).toBe('sunday');
		expect(result.config?.viewCatalog?.entries).toHaveLength(2);
	});

	it('returns shared config but blocks catalog mutation for structural view errors', () => {
		const result = parseCalendarConfig('Life/Work/_calendar.md', {
			'calendar-view': true,
			'calendar-views-version': 1,
			'calendar-views': [
				{ id: 'same', name: 'Calendar', type: 'calendar', layout: 'month', 'week-starts-on': 'locale' },
				{ id: 'same', name: 'Board', type: 'board', 'group-by': 'status' },
			],
		});

		expect(result.config).toBeDefined();
		expect(result.config?.viewCatalog?.canMutate).toBe(false);
		expect(result.issues.map((issue) => issue.field)).toEqual([
			'calendar-views[0].id',
			'calendar-views[1].id',
		]);
	});

	it('prefers canonical views and reports ignored legacy settings', () => {
		const result = parseCalendarConfig('Life/Work/_calendar.md', {
			'calendar-view': true,
			'calendar-layout': 'week',
			'calendar-week-starts-on': 'sunday',
			'calendar-views-version': 1,
			'calendar-views': [
				{
					id: 'calendar',
					name: 'Calendar',
					type: 'calendar',
					layout: 'month',
					'week-starts-on': 'monday',
				},
			],
		});

		expect(result.config?.layout).toBe('month');
		expect(result.config?.weekStartsOn).toBe('monday');
		expect(result.issues.map((issue) => issue.field)).toEqual([
			'calendar-layout',
			'calendar-week-starts-on',
		]);
	});

	it('rejects legacy single-file calendar paths', () => {
		const result = parseCalendarConfig('Calendars/Work.md', {
			'calendar-view': true,
		});

		expect(result.isCalendarDocument).toBe(false);
		expect(result.config).toBeUndefined();
		expect(result.issues).toContainEqual({
			field: 'calendar document',
			message: 'Calendar documents must use <root>/<calendar>/_calendar.md.',
		});
	});

	it('recognizes only nested _calendar.md paths as calendar documents', () => {
		expect(isCalendarDocumentPath('Life/Work/_calendar.md')).toBe(true);
		expect(isCalendarDocumentPath('Calendars/Work.md')).toBe(false);
		expect(isCalendarDocumentPath('_calendar.md')).toBe(false);
	});

	it('writes only the stable calendar keys and removes disabled optional keys', () => {
		const parsed = parseCalendarConfig('Life/Calendar/_calendar.md', {
			'calendar-view': true,
		});
		if (!parsed.config) throw new Error('Expected a valid config');
		const frontmatter: Record<string, unknown> = {
			untouched: 'value',
			'calendar-title-property': 'name',
		};
		const config = { ...parsed.config, endDateProperty: undefined, excludePaths: [] };

		applyCalendarConfigWithSavedViewsToFrontmatter(frontmatter, config);

		expect(frontmatter.untouched).toBe('value');
		expect(frontmatter['calendar-end-property']).toBe('');
		expect(frontmatter['calendar-exclude-paths']).toBeUndefined();
		expect(frontmatter['calendar-properties']).toEqual(config.propertyDefinitions);
		expect(frontmatter['calendar-card-color-property']).toBe('status');
		expect(frontmatter['calendar-views-version']).toBe(1);
		expect(frontmatter['calendar-views']).toEqual([
			expect.objectContaining({
				id: 'calendar',
				type: 'calendar',
				layout: 'month',
				'week-starts-on': 'locale',
			}),
		]);
		expect(frontmatter['calendar-layout']).toBeUndefined();
		expect(frontmatter['calendar-week-starts-on']).toBeUndefined();
		expect(frontmatter['calendar-title-property']).toBeUndefined();
		expect(frontmatter['calendar-source']).toBeUndefined();
		expect(frontmatter['calendar-create-folder']).toBeUndefined();
	});

	it('uses the catalog rather than deprecated facade fields when writing views', () => {
		const parsed = parseCalendarConfig('Life/Calendar/_calendar.md', {
			'calendar-view': true,
			'calendar-views-version': 1,
			'calendar-views': [
				{
					id: 'calendar',
					name: 'Calendar',
					type: 'calendar',
					layout: 'month',
					'week-starts-on': 'locale',
				},
			],
		});
		if (!parsed.config) throw new Error('Expected a valid config');
		const frontmatter: Record<string, unknown> = {};

		applyCalendarConfigWithSavedViewsToFrontmatter(frontmatter, {
			...parsed.config,
			layout: 'week',
			weekStartsOn: 'sunday',
		});

		expect(frontmatter['calendar-views']).toEqual([
			expect.objectContaining({ layout: 'month', 'week-starts-on': 'locale' }),
		]);
	});

	it('canonicalizes transitional CalendarConfig callers without a catalog', () => {
		const parsed = parseCalendarConfig('Life/Calendar/_calendar.md', {
			'calendar-view': true,
		});
		if (!parsed.config) throw new Error('Expected a valid config');
		const frontmatter: Record<string, unknown> = {};
		const config = { ...parsed.config, viewCatalog: undefined, layout: 'week' as const };

		applyCalendarConfigWithSavedViewsToFrontmatter(frontmatter, config);

		expect(frontmatter['calendar-views']).toEqual([
			expect.objectContaining({ layout: 'week', 'week-starts-on': 'locale' }),
		]);
	});

	it('preserves raw saved-view keys when writing shared configuration', () => {
		const parsed = parseCalendarConfig('Life/Calendar/_calendar.md', {
			'calendar-view': true,
		});
		if (!parsed.config) throw new Error('Expected a valid config');
		const rawViews = [
			{ id: 'future', name: 'Future', type: 'timeline', settings: { zoom: 'year' } },
		];
		const frontmatter: Record<string, unknown> = {
			'calendar-views-version': 2,
			'calendar-views': structuredClone(rawViews),
		};

		applyCalendarConfigToFrontmatter(frontmatter, {
			...parsed.config,
			name: 'Renamed calendar',
		});

		expect(frontmatter.title).toBe('Renamed calendar');
		expect(frontmatter['calendar-views-version']).toBe(2);
		expect(frontmatter['calendar-views']).toEqual(rawViews);
	});

	it('does not partially mutate frontmatter when a complete catalog write is unsafe', () => {
		const parsed = parseCalendarConfig('Life/Calendar/_calendar.md', {
			'calendar-view': true,
			'calendar-views-version': 2,
			'calendar-views': [{ id: 'future', name: 'Future', type: 'timeline' }],
		});
		const config = parsed.config;
		if (!config) throw new Error('Expected usable shared config');
		const frontmatter: Record<string, unknown> = { untouched: true };
		const original = structuredClone(frontmatter);

		expect(() =>
			applyCalendarConfigWithSavedViewsToFrontmatter(frontmatter, config),
		).toThrow('structurally invalid');
		expect(frontmatter).toEqual(original);
	});

	it('filters fixed event fields from the configurable property schema', () => {
		const result = parseCalendarConfig('Life/Work/_calendar.md', {
			'calendar-view': true,
			'calendar-title-property': 'name',
			'calendar-visible-properties': ['title', 'parent-item', 'sub-items', 'status'],
			'calendar-properties': {
				title: { type: 'text', default: 'Custom title' },
				'parent-item': { type: 'text', default: '[[Parent]]' },
				'sub-items': { type: 'text', default: '[[Child]]' },
				status: { type: 'select', options: ['None', 'Done'] },
			},
		});

		expect(result.issues).toEqual([]);
		expect(result.config?.visibleProperties).toEqual(['status']);
		expect(result.config?.propertyDefinitions).toEqual({
			status: {
				type: 'select',
				options: ['None', 'Done'],
				colors: { None: 'default', Done: 'default' },
			},
		});
	});

	it('never writes fixed event fields into configurable calendar keys', () => {
		const parsed = parseCalendarConfig('Life/Work/_calendar.md', {
			'calendar-view': true,
		});
		if (!parsed.config) throw new Error('Expected a valid config');
		const frontmatter: Record<string, unknown> = {};
		const config = {
			...parsed.config,
			visibleProperties: [
				...parsed.config.visibleProperties,
				'parent-item',
				'sub-items',
			],
			propertyDefinitions: {
				...parsed.config.propertyDefinitions,
				'parent-item': { type: 'text' as const },
				'sub-items': { type: 'text' as const },
			},
			cardColorProperty: 'parent-item',
		};

		applyCalendarConfigToFrontmatter(frontmatter, config);

		expect(frontmatter['calendar-visible-properties']).toEqual(['status', 'type']);
		expect(frontmatter['calendar-properties']).not.toHaveProperty('parent-item');
		expect(frontmatter['calendar-properties']).not.toHaveProperty('sub-items');
		expect(frontmatter['calendar-card-color-property']).toBe('');
	});

	it('rejects fixed event fields as date property names', () => {
		const result = parseCalendarConfig('Life/Work/_calendar.md', {
			'calendar-view': true,
			'calendar-start-property': 'parent-item',
			'calendar-end-property': 'sub-items',
		});

		expect(result.config).toBeUndefined();
		expect(result.issues).toEqual([
			{
				field: 'calendar-start-property',
				message: 'Must not use a reserved event property.',
			},
			{
				field: 'calendar-end-property',
				message: 'Must not use a reserved event property.',
			},
		]);
	});
});
