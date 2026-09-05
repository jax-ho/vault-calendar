import { describe, expect, it } from 'vitest';
import type { CalendarConfig } from '../types';
import {
	applySavedViewCatalogToFrontmatter,
	createDefaultSavedViewCatalog,
	firstCalendarSavedView,
	isValidViewId,
	isWritableBoardGroupProperty,
	parseSavedViewCatalog,
	SAVED_VIEW_KEYS,
	serializeSavedViewCatalog,
	validSavedViews,
} from './saved-views';

const context = {
	startDateProperty: 'date',
	endDateProperty: 'date-end',
	propertyDefinitions: {
		status: { type: 'select' as const, options: ['None', 'Open', 'Done'] },
		type: { type: 'select' as const, options: ['None', 'Task', 'Idea'] },
		owner: { type: 'text' as const },
	},
};

describe('saved-view catalogs', () => {
	it('creates and serializes one canonical Calendar view', () => {
		const catalog = createDefaultSavedViewCatalog('week', 'monday');

		expect(firstCalendarSavedView(catalog)).toEqual({
			id: 'calendar',
			name: 'Calendar view',
			type: 'calendar',
			layout: 'week',
			weekStartsOn: 'monday',
		});
		expect(serializeSavedViewCatalog(catalog)).toEqual([
			{
				id: 'calendar',
				name: 'Calendar view',
				type: 'calendar',
				layout: 'week',
				'week-starts-on': 'monday',
			},
		]);
	});

	it('adapts legacy layout settings in memory without mutating frontmatter', () => {
		const frontmatter = {
			'calendar-layout': 'week',
			'calendar-week-starts-on': 'sunday',
		};
		const original = structuredClone(frontmatter);

		const result = parseSavedViewCatalog(frontmatter, context);

		expect(result.issues).toEqual([]);
		expect(result.catalog.source).toBe('legacy');
		expect(result.catalog.canMutate).toBe(true);
		expect(validSavedViews(result.catalog)).toEqual([
			{
				id: 'calendar',
				name: 'Calendar view',
				type: 'calendar',
				layout: 'week',
				weekStartsOn: 'sunday',
			},
		]);
		expect(frontmatter).toEqual(original);
	});

	it('adapts the intermediate Board key and keeps an empty value as setup', () => {
		const setup = parseSavedViewCatalog(
			{ 'calendar-board-group-property': '' },
			context,
		);
		const configured = parseSavedViewCatalog(
			{ 'calendar-board-group-property': 'status' },
			context,
		);

		expect(validSavedViews(setup.catalog)).toEqual([
			expect.objectContaining({ id: 'calendar', type: 'calendar' }),
			{ id: 'board', name: 'Board', type: 'board' },
		]);
		expect(setup.issues).toContainEqual(
			expect.objectContaining({
				field: 'calendar-board-group-property',
				viewId: 'board',
			}),
		);
		expect(validSavedViews(configured.catalog).at(1)).toEqual({
			id: 'board',
			name: 'Board',
			type: 'board',
			groupBy: 'status',
		});
	});

	it('parses ordered canonical Calendar and Board definitions', () => {
		const result = parseSavedViewCatalog(
			{
				'calendar-views-version': 1,
				'calendar-views': [
					{
						id: 'calendar',
						name: 'Week',
						type: 'calendar',
						layout: 'week',
						'week-starts-on': 'monday',
					},
					{ id: 'work-board', name: 'Work', type: 'board', 'group-by': 'status' },
					{ id: 'idea-board', name: 'Ideas', type: 'board', 'group-by': 'type' },
				],
			},
			context,
		);

		expect(result.issues).toEqual([]);
		expect(result.catalog).toMatchObject({ source: 'canonical', canMutate: true });
		expect(validSavedViews(result.catalog)).toEqual([
			{
				id: 'calendar',
				name: 'Week',
				type: 'calendar',
				layout: 'week',
				weekStartsOn: 'monday',
			},
			{ id: 'work-board', name: 'Work', type: 'board', groupBy: 'status' },
			{ id: 'idea-board', name: 'Ideas', type: 'board', groupBy: 'type' },
		]);
		expect(serializeSavedViewCatalog(result.catalog)).toEqual([
			expect.objectContaining({ id: 'calendar', layout: 'week' }),
			expect.objectContaining({ id: 'work-board', 'group-by': 'status' }),
			expect.objectContaining({ id: 'idea-board', 'group-by': 'type' }),
		]);
	});

	it('keeps manually duplicated names by ID and reports view-local warnings', () => {
		const result = parseSavedViewCatalog(
			{
				'calendar-views-version': 1,
				'calendar-views': [
					{
						id: 'calendar',
						name: ' Work ',
						type: 'calendar',
						layout: 'month',
						'week-starts-on': 'locale',
					},
					{ id: 'board', name: 'work', type: 'board', 'group-by': 'status' },
				],
			},
			context,
		);

		expect(result.catalog.canMutate).toBe(true);
		expect(validSavedViews(result.catalog).map(({ id, name }) => ({ id, name }))).toEqual([
			{ id: 'calendar', name: 'Work' },
			{ id: 'board', name: 'work' },
		]);
		expect(result.issues).toEqual([
			expect.objectContaining({
				field: 'calendar-views[0].name',
				viewId: 'calendar',
			}),
			expect.objectContaining({
				field: 'calendar-views[1].name',
				viewId: 'board',
			}),
		]);
		expect(result.catalog.entries[0]).toMatchObject({
			kind: 'valid',
			definition: { id: 'calendar' },
			warnings: [
				{
					field: 'calendar-views[0].name',
					message: 'View names should be unique.',
					viewId: 'calendar',
				},
			],
		});
		expect(result.catalog.entries[1]).toMatchObject({
			kind: 'valid',
			definition: { id: 'board' },
			warnings: [
				{
					field: 'calendar-views[1].name',
					message: 'View names should be unique.',
					viewId: 'board',
				},
			],
		});
	});

	it('defaults missing canonical Calendar settings and writes them explicitly', () => {
		const result = parseSavedViewCatalog(
			{
				'calendar-views-version': 1,
				'calendar-views': [{ id: 'calendar', name: 'Calendar', type: 'calendar' }],
			},
			context,
		);

		expect(result.catalog.canMutate).toBe(true);
		expect(result.issues.map((issue) => issue.field)).toEqual([
			'calendar-views[0].layout',
			'calendar-views[0].week-starts-on',
		]);
		expect(serializeSavedViewCatalog(result.catalog)[0]).toMatchObject({
			layout: 'month',
			'week-starts-on': 'locale',
		});
	});

	it('keeps Board setup and stale group references view-local', () => {
		const result = parseSavedViewCatalog(
			{
				'calendar-views-version': 1,
				'calendar-views': [
					{ id: 'setup', name: 'Setup', type: 'board' },
					{ id: 'stale', name: 'Stale', type: 'board', 'group-by': 'missing' },
				],
			},
			context,
		);

		expect(result.catalog.canMutate).toBe(true);
		expect(validSavedViews(result.catalog)).toEqual([
			{ id: 'setup', name: 'Setup', type: 'board' },
			{ id: 'stale', name: 'Stale', type: 'board', groupBy: 'missing' },
		]);
		expect(result.issues).toHaveLength(2);
		expect(result.issues.every((issue) => 'viewId' in issue)).toBe(true);
	});

	it('preserves explicit invalid per-view settings without blocking other mutations', () => {
		const rawInvalid = {
			id: 'bad-calendar',
			name: 'Bad',
			type: 'calendar',
			layout: 'timeline',
			'week-starts-on': 'locale',
		};
		const result = parseSavedViewCatalog(
			{
				'calendar-views-version': 1,
				'calendar-views': [
					rawInvalid,
					{ id: 'board', name: 'Board', type: 'board', 'group-by': 'status' },
				],
			},
			context,
		);

		expect(result.catalog.canMutate).toBe(true);
		expect(result.catalog.entries[0]).toMatchObject({
			kind: 'invalid',
			id: 'bad-calendar',
			raw: rawInvalid,
		});
		expect(serializeSavedViewCatalog(result.catalog)[0]).toEqual(rawInvalid);
		expect(validSavedViews(result.catalog)).toEqual([
			{ id: 'board', name: 'Board', type: 'board', groupBy: 'status' },
		]);
	});

	it.each([
		{
			name: 'a missing version',
			frontmatter: {
				'calendar-views': [
					{
						id: 'calendar',
						name: 'Calendar',
						type: 'calendar',
						layout: 'month',
						'week-starts-on': 'locale',
					},
				],
			},
		},
		{
			name: 'an empty list',
			frontmatter: { 'calendar-views-version': 1, 'calendar-views': [] },
		},
		{
			name: 'duplicate IDs',
			frontmatter: {
				'calendar-views-version': 1,
				'calendar-views': [
					{ id: 'same', name: 'One', type: 'board' },
					{ id: 'same', name: 'Two', type: 'board' },
				],
			},
		},
		{
			name: 'an unknown field',
			frontmatter: {
				'calendar-views-version': 1,
				'calendar-views': [
					{
						id: 'calendar',
						name: 'Calendar',
						type: 'calendar',
						layout: 'month',
						'week-starts-on': 'locale',
						future: true,
					},
				],
			},
		},
	])('blocks rewrites for $name', ({ frontmatter }) => {
		const result = parseSavedViewCatalog(frontmatter, context);
		expect(result.catalog.canMutate).toBe(false);
		expect(() => serializeSavedViewCatalog(result.catalog)).toThrow(
			'structurally invalid',
		);
	});

	it('preserves entries from an unknown schema version', () => {
		const raw = { id: 'timeline', name: 'Timeline', type: 'timeline', zoom: 'year' };
		const result = parseSavedViewCatalog(
			{ 'calendar-views-version': 2, 'calendar-views': [raw] },
			context,
		);

		expect(result.catalog.canMutate).toBe(false);
		expect(result.catalog.entries).toEqual([
			{
				kind: 'unsupported',
				id: 'timeline',
				name: 'Timeline',
				viewType: 'timeline',
				raw,
			},
		]);
	});

	it('canonicalizes a legacy catalog and removes compatibility keys atomically', () => {
		const frontmatter: Record<string, unknown> = {
			'calendar-layout': 'week',
			'calendar-week-starts-on': 'monday',
			'calendar-board-group-property': 'status',
			untouched: true,
		};
		const { catalog } = parseSavedViewCatalog(frontmatter, context);

		expect(applySavedViewCatalogToFrontmatter(frontmatter, catalog)).toBe(true);
		expect(frontmatter).toMatchObject({
			[SAVED_VIEW_KEYS.version]: 1,
			untouched: true,
		});
		expect(frontmatter[SAVED_VIEW_KEYS.views]).toEqual([
			expect.objectContaining({ id: 'calendar', layout: 'week' }),
			expect.objectContaining({ id: 'board', 'group-by': 'status' }),
		]);
		expect(frontmatter).not.toHaveProperty('calendar-layout');
		expect(frontmatter).not.toHaveProperty('calendar-week-starts-on');
		expect(frontmatter).not.toHaveProperty('calendar-board-group-property');
	});

	it('leaves raw canonical keys untouched when the catalog cannot mutate', () => {
		const frontmatter: Record<string, unknown> = {
			'calendar-views-version': 2,
			'calendar-views': [{ id: 'future', name: 'Future', type: 'timeline' }],
		};
		const original = structuredClone(frontmatter);
		const { catalog } = parseSavedViewCatalog(frontmatter, context);

		expect(applySavedViewCatalogToFrontmatter(frontmatter, catalog)).toBe(false);
		expect(frontmatter).toEqual(original);
	});
});

describe('saved-view validation helpers', () => {
	it.each(['calendar', 'work-board', '24763e20-4957-4f45-98c3-23173b90a43e'])(
		'accepts valid view ID %s',
		(id) => expect(isValidViewId(id)).toBe(true),
	);

	it.each(['', '-board', 'board-', 'Board', 'board_name', 'x'.repeat(65)])(
		'rejects invalid view ID %s',
		(id) => expect(isValidViewId(id)).toBe(false),
	);

	it('accepts only writable Select group properties', () => {
		const config = {
			documentPath: 'Life/Work/_calendar.md',
			name: 'Work',
			sourceFolder: 'Life/Work',
			recursive: true,
			startDateProperty: 'date',
			endDateProperty: 'date-end',
			visibleProperties: [],
			propertyDefinitions: {
				...context.propertyDefinitions,
				date: { type: 'select' as const, options: ['None', 'Today'] },
				position: { type: 'select' as const, options: ['None', 'First'] },
				duplicate: { type: 'select' as const, options: ['None', 'Same', 'Same'] },
				title: { type: 'select' as const, options: ['None', 'Heading'] },
			},
			weekStartsOn: 'locale',
			layout: 'month',
			openBehavior: 'same-leaf',
			createFolder: 'Life/Work',
			excludePaths: [],
		} satisfies CalendarConfig;

		expect(isWritableBoardGroupProperty(config, 'status')).toBe(true);
		expect(isWritableBoardGroupProperty(config, 'owner')).toBe(false);
		expect(isWritableBoardGroupProperty(config, 'date')).toBe(false);
		expect(isWritableBoardGroupProperty(config, 'position')).toBe(false);
		expect(isWritableBoardGroupProperty(config, 'duplicate')).toBe(false);
		expect(isWritableBoardGroupProperty(config, 'title')).toBe(false);
	});
});
