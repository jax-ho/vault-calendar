import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarConfig } from '../types';
import {
	applyCalendarConfigWithSavedViewsToFrontmatter,
	parseCalendarConfig,
} from '../domain/config';
import { CalendarConfigMutationCoordinator } from './calendar-config-mutation-coordinator';

const obsidianClasses = vi.hoisted(() => {
	class MockFile {
		basename: string;
		path: string;
		stat = { mtime: 1 };

		constructor(path: string) {
			this.path = path;
			this.basename = path.split('/').at(-1)?.replace(/\.md$/u, '') ?? path;
		}
	}

	class MockFolder {
		constructor(readonly path: string) {}
	}

	return { MockFile, MockFolder };
});

vi.mock('obsidian', () => ({
	getFrontMatterInfo: (content: string) => {
		if (!content.startsWith('---\n')) {
			return { exists: false, frontmatter: '', contentStart: 0 };
		}
		const closing = content.indexOf('\n---', 4);
		return {
			exists: closing >= 0,
			frontmatter: closing >= 0 ? content.slice(4, closing) : '',
			contentStart: closing >= 0 ? closing + 4 : 0,
		};
	},
	normalizePath: (path: string) => path,
	parseYaml: (value: string) => JSON.parse(value) as unknown,
	stringifyYaml: (frontmatter: Record<string, unknown>) => `${JSON.stringify(frontmatter)}\n`,
	TFile: obsidianClasses.MockFile,
	TFolder: obsidianClasses.MockFolder,
}));

import { CalendarDocumentService, type CreateCalendarInput } from './calendar-document';

function createTestApp(): {
	app: App;
	create: ReturnType<typeof vi.fn>;
	createFolder: ReturnType<typeof vi.fn>;
	processFrontMatter: ReturnType<typeof vi.fn>;
	read: ReturnType<typeof vi.fn>;
	seedFile: (path: string, frontmatter: Record<string, unknown>) => void;
	frontmatterFor: (path: string) => Record<string, unknown> | undefined;
} {
	const entries = new Map<string, unknown>();
	const frontmatters = new Map<string, Record<string, unknown>>();
	const contents = new Map<string, string>();
	const encode = (frontmatter: Record<string, unknown>): string =>
		`---\n${JSON.stringify(frontmatter)}\n---\n`;
	const createFolder = vi.fn(async (path: string) => {
		entries.set(path, new obsidianClasses.MockFolder(path));
	});
	const create = vi.fn(async (path: string, content: string) => {
		const file = new obsidianClasses.MockFile(path);
		entries.set(path, file);
		contents.set(path, content);
		return file;
	});
	const read = vi.fn(async (file: InstanceType<typeof obsidianClasses.MockFile>) =>
		contents.get(file.path) ?? '',
	);
	const processFrontMatter = vi.fn(
		async (
			file: InstanceType<typeof obsidianClasses.MockFile>,
			mutate: (frontmatter: Record<string, unknown>) => void,
		) => {
			const frontmatter = frontmatters.get(file.path) ?? {};
			mutate(frontmatter);
			frontmatters.set(file.path, frontmatter);
			contents.set(file.path, encode(frontmatter));
		},
	);
	const seedFile = (path: string, frontmatter: Record<string, unknown>): void => {
		entries.set(path, new obsidianClasses.MockFile(path));
		frontmatters.set(path, frontmatter);
		contents.set(path, encode(frontmatter));
	};
	const app = {
		vault: {
			create,
			createFolder,
			getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
			getFileByPath: (path: string) => {
				const entry = entries.get(path);
				return entry instanceof obsidianClasses.MockFile ? entry : null;
			},
			read,
		},
		metadataCache: {
			getFileCache: (file: InstanceType<typeof obsidianClasses.MockFile>) => ({
				frontmatter: frontmatters.get(file.path),
			}),
		},
		fileManager: { processFrontMatter },
	} as unknown as App;
	return {
		app,
		create,
		createFolder,
		processFrontMatter,
		read,
		seedFile,
		frontmatterFor: (path) => frontmatters.get(path),
	};
}

function calendarConfig(): CalendarConfig {
	return {
		documentPath: 'Life/Work/_calendar.md',
		name: 'Work',
		sourceFolder: 'Life/Work',
		recursive: true,
		startDateProperty: 'date',
		endDateProperty: 'date-end',
		visibleProperties: [],
		propertyDefinitions: {
			status: { type: 'select', options: ['Not started', 'Done'], default: 'Not started' },
			important: { type: 'checkbox', default: false },
		},
		viewCatalog: {
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
			],
		},
		weekStartsOn: 'monday',
		layout: 'month',
		openBehavior: 'same-leaf',
		createFolder: 'Life/Work',
		excludePaths: [],
	};
}

function calendarDocuments(
	app: App,
	createEventId?: () => string,
): CalendarDocumentService {
	return new CalendarDocumentService(
		app,
		createEventId,
		new CalendarConfigMutationCoordinator(),
	);
}

describe('calendar document file layout', () => {
	it('can parse the current file contents when metadata cache still has an older view', async () => {
		const path = 'Life/Work/_calendar.md';
		const stale = {
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
				{ id: 'board', name: 'Board', type: 'board', 'group-by': 'status' },
			],
		};
		const fresh = structuredClone(stale);
		const freshBoard = fresh['calendar-views'][1];
		if (!freshBoard) throw new Error('Expected a Board view fixture.');
		freshBoard['group-by'] = 'type';
		const { app, read, seedFile } = createTestApp();
		seedFile(path, stale);
		const file = await app.vault.create(path, `---\n${JSON.stringify(fresh)}\n---\n`);
		const service = calendarDocuments(app);

		const cached = service.read(file);
		const current = await service.readFresh(file);

		expect(cached.config?.viewCatalog?.entries[1]).toMatchObject({
			definition: { type: 'board', groupBy: 'status' },
		});
		expect(current.config?.viewCatalog?.entries[1]).toMatchObject({
			definition: { type: 'board', groupBy: 'type' },
		});
		expect(read).toHaveBeenCalledExactlyOnceWith(file);
	});

	it('stores the calendar definition inside its dedicated folder', async () => {
		const { app, create, createFolder } = createTestApp();
		const input: CreateCalendarInput = {
			name: 'Work',
			documentFolder: 'Life/Work',
			startDateProperty: 'date',
			endDateProperty: 'date-end',
		};

		const file = await calendarDocuments(app).create(input);

		expect(file.path).toBe('Life/Work/_calendar.md');
		expect(createFolder).toHaveBeenNthCalledWith(1, 'Life');
		expect(createFolder).toHaveBeenNthCalledWith(2, 'Life/Work');
		expect(create).toHaveBeenCalledWith(
			'Life/Work/_calendar.md',
			expect.stringContaining('"title":"Work"'),
		);
		expect(create.mock.calls[0]?.[1]).toContain('"calendar-properties"');
		expect(create.mock.calls[0]?.[1]).toContain(
			'"calendar-visible-properties":["status","type"]',
		);
		expect(create.mock.calls[0]?.[1]).toContain(
			'"calendar-card-color-property":"status"',
		);
		expect(create.mock.calls[0]?.[1]).toContain('"calendar-views-version":1');
		expect(create.mock.calls[0]?.[1]).toContain(
			'"calendar-views":[{"id":"calendar","name":"Calendar view","type":"calendar","layout":"month","week-starts-on":"locale"}]',
		);
		expect(create.mock.calls[0]?.[1]).not.toContain('calendar-layout');
		expect(create.mock.calls[0]?.[1]).not.toContain('calendar-week-starts-on');
		expect(create.mock.calls[0]?.[1]).not.toContain('calendar-title-property');
		expect(create.mock.calls[0]?.[1]).not.toContain('"Important"');
		expect(create.mock.calls[0]?.[1]).not.toContain('calendar-source');
		expect(create.mock.calls[0]?.[1]).not.toContain('calendar-create-folder');
	});

	it('canonicalizes legacy views on the first shared-config save', async () => {
		const path = 'Life/Work/_calendar.md';
		const legacy = {
			'calendar-view': true,
			title: 'Work',
			'calendar-layout': 'week',
			'calendar-week-starts-on': 'sunday',
			'calendar-board-group-property': 'status',
		};
		const parsed = parseCalendarConfig(path, legacy);
		if (!parsed.config) throw new Error('Expected a valid legacy config');
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, structuredClone(legacy));

		await calendarDocuments(app).save(parsed.config);

		const frontmatter = frontmatterFor(path);
		expect(frontmatter?.['calendar-views-version']).toBe(1);
		expect(frontmatter?.['calendar-views']).toEqual([
			expect.objectContaining({
				id: 'calendar',
				layout: 'week',
				'week-starts-on': 'sunday',
			}),
			expect.objectContaining({ id: 'board', 'group-by': 'status' }),
		]);
		expect(frontmatter).not.toHaveProperty('calendar-layout');
		expect(frontmatter).not.toHaveProperty('calendar-week-starts-on');
		expect(frontmatter).not.toHaveProperty('calendar-board-group-property');
	});

	it('does not let a stale shared config overwrite newer saved views', async () => {
		const path = 'Life/Work/_calendar.md';
		const stale = parseCalendarConfig(path, {
			'calendar-view': true,
			title: 'Before',
			'calendar-layout': 'month',
		});
		if (!stale.config) throw new Error('Expected a valid stale config');
		const currentViews = [
			{
				id: 'calendar',
				name: 'Calendar view',
				type: 'calendar',
				layout: 'month',
				'week-starts-on': 'locale',
			},
			{ id: 'new-board', name: 'New Board', type: 'board', 'group-by': 'status' },
		];
		const current = {
			'calendar-view': true,
			title: 'Before',
			'calendar-views-version': 1,
			'calendar-views': structuredClone(currentViews),
		};
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, current);
		const coordinator = new CalendarConfigMutationCoordinator();

		await new CalendarDocumentService(app, undefined, coordinator).save({
			...stale.config,
			name: 'After',
		});

		expect(frontmatterFor(path)?.title).toBe('After');
		expect(frontmatterFor(path)?.['calendar-views']).toEqual(currentViews);
	});

	it('merges changed fields from stale leaves instead of losing either update', async () => {
		const path = 'Life/Work/_calendar.md';
		const base = calendarConfig();
		const frontmatter: Record<string, unknown> = {};
		applyCalendarConfigWithSavedViewsToFrontmatter(frontmatter, base);
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, frontmatter);
		const coordinator = new CalendarConfigMutationCoordinator();
		const firstLeaf = new CalendarDocumentService(app, undefined, coordinator);
		const secondLeaf = new CalendarDocumentService(app, undefined, coordinator);

		await Promise.all([
			firstLeaf.save(
				{ ...base, openBehavior: 'new-tab' },
				{ changedFields: ['openBehavior'] },
			),
			secondLeaf.save(
				{ ...base, recursive: false },
				{ changedFields: ['recursive'] },
			),
		]);

		expect(frontmatterFor(path)?.['calendar-open-behavior']).toBe('new-tab');
		expect(frontmatterFor(path)?.['calendar-recursive']).toBe(false);
	});

	it('merges different property additions from stale leaves', async () => {
		const path = 'Life/Work/_calendar.md';
		const base = calendarConfig();
		const frontmatter: Record<string, unknown> = {};
		applyCalendarConfigWithSavedViewsToFrontmatter(frontmatter, base);
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, frontmatter);
		const coordinator = new CalendarConfigMutationCoordinator();
		const firstLeaf = new CalendarDocumentService(app, undefined, coordinator);
		const secondLeaf = new CalendarDocumentService(app, undefined, coordinator);

		await Promise.all([
			firstLeaf.save(base, {
				propertyMutations: [
					{
						kind: 'add',
						property: 'effort',
						definition: { type: 'number', default: 1 },
					},
				],
			}),
			secondLeaf.save(base, {
				propertyMutations: [
					{
						kind: 'add',
						property: 'owner',
						definition: { type: 'text' },
					},
				],
			}),
		]);

		expect(frontmatterFor(path)?.['calendar-properties']).toMatchObject({
			effort: { type: 'number', default: 1 },
			owner: { type: 'text' },
		});
		expect(frontmatterFor(path)?.['calendar-visible-properties']).toEqual([
			'effort',
			'owner',
		]);
	});

	it('keeps a completed rename when a stale leaf edits another property', async () => {
		const path = 'Life/Work/_calendar.md';
		const baseFrontmatter: Record<string, unknown> = {};
		applyCalendarConfigWithSavedViewsToFrontmatter(
			baseFrontmatter,
			{ ...calendarConfig(), cardColorProperty: 'status' },
		);
		const stale = parseCalendarConfig(path, baseFrontmatter).config;
		if (!stale) throw new Error('Expected a valid stale config');
		const latest: CalendarConfig = {
			...stale,
			propertyDefinitions: Object.fromEntries(
				Object.entries(stale.propertyDefinitions).map(([property, definition]) => [
					property === 'status' ? 'stage' : property,
					definition,
				]),
			),
			visibleProperties: stale.visibleProperties.map((property) =>
				property === 'status' ? 'stage' : property,
			),
			cardColorProperty:
				stale.cardColorProperty === 'status' ? 'stage' : stale.cardColorProperty,
		};
		const latestFrontmatter: Record<string, unknown> = {};
		applyCalendarConfigWithSavedViewsToFrontmatter(latestFrontmatter, latest);
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, latestFrontmatter);

		await calendarDocuments(app).save(stale, {
			propertyMutations: [
				{
					kind: 'update',
					property: 'important',
					expectedDefinition: stale.propertyDefinitions.important!,
					definition: { type: 'checkbox', default: true },
				},
				{
					kind: 'set-visibility',
					property: 'important',
					expectedVisible: false,
					visible: true,
				},
			],
		});

		const savedProperties = frontmatterFor(path)?.['calendar-properties'];
		expect(savedProperties).not.toHaveProperty('status');
		const definitions = savedProperties as Record<string, unknown>;
		expect(definitions.stage).toMatchObject({ type: 'select' });
		expect(definitions.important).toEqual({ type: 'checkbox', default: true });
		expect(frontmatterFor(path)?.['calendar-visible-properties']).toContain(
			'important',
		);
		expect(frontmatterFor(path)?.['calendar-card-color-property']).toBe('stage');
	});

	it('fails closed when a stale visibility edit targets a renamed property', async () => {
		const path = 'Life/Work/_calendar.md';
		const baseFrontmatter: Record<string, unknown> = {};
		applyCalendarConfigWithSavedViewsToFrontmatter(
			baseFrontmatter,
			calendarConfig(),
		);
		const stale = parseCalendarConfig(path, baseFrontmatter).config;
		if (!stale) throw new Error('Expected a valid stale config');
		const latestFrontmatter = structuredClone(baseFrontmatter);
		const definitions = latestFrontmatter['calendar-properties'] as Record<string, unknown>;
		definitions.stage = definitions.status;
		delete definitions.status;
		const original = structuredClone(latestFrontmatter);
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, latestFrontmatter);

		await expect(
			calendarDocuments(app).save(stale, {
				propertyMutations: [
					{
						kind: 'set-visibility',
						property: 'status',
						expectedVisible: false,
						visible: true,
					},
				],
			}),
		).rejects.toThrow('status changed in another tab or pane');
		expect(frontmatterFor(path)).toEqual(original);
	});

	it('rebases property order, visibility, and card color over a concurrent addition', async () => {
		const path = 'Life/Work/_calendar.md';
		const initialFrontmatter: Record<string, unknown> = {};
		applyCalendarConfigWithSavedViewsToFrontmatter(initialFrontmatter, {
			...calendarConfig(),
			cardColorProperty: 'status',
		});
		const stale = parseCalendarConfig(path, initialFrontmatter).config;
		if (!stale) throw new Error('Expected a valid stale config');
		const latest: CalendarConfig = {
			...stale,
			propertyDefinitions: {
				...stale.propertyDefinitions,
				owner: { type: 'text' },
			},
			visibleProperties: [...stale.visibleProperties, 'owner'],
		};
		const latestFrontmatter: Record<string, unknown> = {};
		applyCalendarConfigWithSavedViewsToFrontmatter(latestFrontmatter, latest);
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, latestFrontmatter);

		await calendarDocuments(app).save(stale, {
			propertyMutations: [
				{
					kind: 'reorder',
					expectedOrder: ['status', 'important'],
					order: ['important', 'status'],
				},
				{
					kind: 'set-visibility',
					property: 'important',
					expectedVisible: false,
					visible: true,
				},
				{
					kind: 'set-card-color',
					expectedProperty: 'status',
					property: undefined,
				},
			],
		});

		const definitions = frontmatterFor(path)?.['calendar-properties'] as Record<
			string,
			unknown
		>;
		expect(Object.keys(definitions)).toEqual(['important', 'status', 'owner']);
		expect(frontmatterFor(path)?.['calendar-visible-properties']).toEqual([
			'important',
			'owner',
		]);
		expect(frontmatterFor(path)?.['calendar-card-color-property']).toBe('');
	});

	it('does not restore a stale property schema when saving an unrelated field', async () => {
		const path = 'Life/Work/_calendar.md';
		const stale = calendarConfig();
		const latest: CalendarConfig = {
			...stale,
			propertyDefinitions: {
				stage: stale.propertyDefinitions.status ?? { type: 'select' },
				important: stale.propertyDefinitions.important ?? { type: 'checkbox' },
			},
			visibleProperties: ['stage', 'important'],
			cardColorProperty: 'stage',
			viewCatalog: {
				source: 'canonical',
				canMutate: true,
				entries: [
					...(stale.viewCatalog?.entries ?? []),
					{
						kind: 'valid',
						definition: {
							id: 'stage-board',
							name: 'Stage board',
							type: 'board',
							groupBy: 'stage',
						},
					},
				],
			},
		};
		const frontmatter: Record<string, unknown> = {};
		applyCalendarConfigWithSavedViewsToFrontmatter(frontmatter, latest);
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, frontmatter);

		await calendarDocuments(app).save(
			{ ...stale, name: 'Renamed calendar' },
			{ changedFields: ['name'] },
		);

		const savedProperties = frontmatterFor(path)?.['calendar-properties'];
		expect(savedProperties).not.toHaveProperty('status');
		expect(savedProperties).toMatchObject({
			stage: { type: 'select' },
			important: { type: 'checkbox' },
		});
		const stage = (savedProperties as Record<string, unknown> | undefined)?.stage;
		const stageOptions = (stage as Record<string, unknown> | undefined)?.options;
		expect(stageOptions).toEqual(expect.arrayContaining(['Not started', 'Done']));
		expect(frontmatterFor(path)?.['calendar-views']).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'stage-board', 'group-by': 'stage' }),
			]),
		);
	});

	it('preserves an unsupported raw catalog during shared-config saves', async () => {
		const path = 'Life/Work/_calendar.md';
		const config = calendarConfig();
		const rawViews = [
			{
				id: 'future',
				name: 'Future',
				type: 'timeline',
				settings: { zoom: 'year' },
			},
		];
		const current = {
			'calendar-view': true,
			'calendar-views-version': 2,
			'calendar-views': structuredClone(rawViews),
		};
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, current);

		await calendarDocuments(app).save({ ...config, documentPath: path });

		expect(frontmatterFor(path)?.['calendar-views-version']).toBe(2);
		expect(frontmatterFor(path)?.['calendar-views']).toEqual(rawViews);
	});

	it('preserves an invalid Board group during an ordinary shared-config save', async () => {
		const path = 'Life/Work/_calendar.md';
		const currentViews = [
			{
				id: 'calendar',
				name: 'Calendar view',
				type: 'calendar',
				layout: 'week',
				'week-starts-on': 'sunday',
			},
			{ id: 'new-board', name: 'New Board', type: 'board', 'group-by': 'status' },
		];
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, {
			'calendar-view': true,
			'calendar-views-version': 1,
			'calendar-views': structuredClone(currentViews),
		});
		const nextConfig = {
			...calendarConfig(),
			propertyDefinitions: {
				...calendarConfig().propertyDefinitions,
				status: { type: 'checkbox' as const },
			},
			cardColorProperty: undefined,
		};

		await calendarDocuments(app).save(nextConfig);

		expect(frontmatterFor(path)?.['calendar-views']).toEqual(currentViews);
	});

	it('clears only matching Board groups added after a stale modal opened', async () => {
		const path = 'Life/Work/_calendar.md';
		const initialFrontmatter: Record<string, unknown> = {};
		applyCalendarConfigWithSavedViewsToFrontmatter(
			initialFrontmatter,
			calendarConfig(),
		);
		const staleConfig = parseCalendarConfig(path, initialFrontmatter).config;
		if (!staleConfig) throw new Error('Expected a valid stale config');
		const latestConfig: CalendarConfig = {
			...staleConfig,
			viewCatalog: {
				source: 'canonical',
				canMutate: true,
				entries: [
					...(staleConfig.viewCatalog?.entries ?? []),
					{
						kind: 'valid',
						definition: {
							id: 'new-board',
							name: 'New Board',
							type: 'board',
							groupBy: 'status',
						},
					},
					{
						kind: 'valid',
						definition: {
							id: 'stale-board',
							name: 'Stale Board',
							type: 'board',
							groupBy: 'ArchivedStage',
						},
					},
				],
			},
		};
		const latestFrontmatter: Record<string, unknown> = {};
		applyCalendarConfigWithSavedViewsToFrontmatter(
			latestFrontmatter,
			latestConfig,
		);
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, latestFrontmatter);

		await calendarDocuments(app).save(staleConfig, {
			propertyMutations: [
				{
					kind: 'update',
					property: 'status',
					expectedDefinition: staleConfig.propertyDefinitions.status!,
					definition: { type: 'checkbox', default: false },
				},
			],
		});

		expect(frontmatterFor(path)?.['calendar-views']).toEqual([
			expect.objectContaining({ id: 'calendar' }),
			{ id: 'new-board', name: 'New Board', type: 'board' },
			{
				id: 'stale-board',
				name: 'Stale Board',
				type: 'board',
				'group-by': 'ArchivedStage',
			},
		]);
	});

	it('clears a newly conflicting date-field Board without touching another stale Board', async () => {
		const path = 'Life/Work/_calendar.md';
		const initialFrontmatter: Record<string, unknown> = {};
		applyCalendarConfigWithSavedViewsToFrontmatter(
			initialFrontmatter,
			calendarConfig(),
		);
		const staleConfig = parseCalendarConfig(path, initialFrontmatter).config;
		if (!staleConfig) throw new Error('Expected a valid stale config');
		const latestConfig: CalendarConfig = {
			...staleConfig,
			viewCatalog: {
				source: 'canonical',
				canMutate: true,
				entries: [
					...(staleConfig.viewCatalog?.entries ?? []),
					{
						kind: 'valid',
						definition: {
							id: 'status-board',
							name: 'Status Board',
							type: 'board',
							groupBy: 'status',
						},
					},
					{
						kind: 'valid',
						definition: {
							id: 'stale-board',
							name: 'Stale Board',
							type: 'board',
							groupBy: 'ArchivedStage',
						},
					},
				],
			},
		};
		const latestFrontmatter: Record<string, unknown> = {};
		applyCalendarConfigWithSavedViewsToFrontmatter(
			latestFrontmatter,
			latestConfig,
		);
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, latestFrontmatter);

		await calendarDocuments(app).save(
			{ ...staleConfig, startDateProperty: 'status' },
			{
				changedFields: ['startDateProperty'],
				revalidateBoardGroups: ['status'],
			},
		);

		expect(frontmatterFor(path)?.['calendar-views']).toEqual([
			expect.objectContaining({ id: 'calendar' }),
			{ id: 'status-board', name: 'Status Board', type: 'board' },
			{
				id: 'stale-board',
				name: 'Stale Board',
				type: 'board',
				'group-by': 'ArchivedStage',
			},
		]);
	});

	it('fails closed before shared fields change when explicit Board cleanup cannot rewrite the catalog', async () => {
		const path = 'Life/Work/_calendar.md';
		const current = {
			'calendar-view': true,
			title: 'Before',
			'calendar-views-version': 1,
			'calendar-views': [
				{
					id: 'duplicate',
					name: 'Calendar',
					type: 'calendar',
					layout: 'month',
					'week-starts-on': 'locale',
				},
				{ id: 'duplicate', name: 'Board', type: 'board', 'group-by': 'status' },
			],
		};
		const original = structuredClone(current);
		const { app, seedFile, frontmatterFor } = createTestApp();
		seedFile(path, current);

		await expect(
			calendarDocuments(app).save(
				{
					...calendarConfig(),
					name: 'After',
					startDateProperty: 'status',
				},
				{
					changedFields: ['name', 'startDateProperty'],
					revalidateBoardGroups: ['status'],
				},
			),
		).rejects.toThrow('structurally invalid saved-view catalog');

		expect(frontmatterFor(path)).toEqual(original);
	});

	it('refuses to create a root-level _calendar.md without a calendar folder', async () => {
		const { app } = createTestApp();
		await expect(
			calendarDocuments(app).create({
				name: 'Work',
				documentFolder: '',
				startDateProperty: 'date',
				endDateProperty: 'date-end',
			}),
		).rejects.toThrow('Calendars require a dedicated folder.');
	});

	it('refuses fixed relationship fields as calendar date properties', async () => {
		const { app, create } = createTestApp();
		await expect(
			calendarDocuments(app).create({
				name: 'Work',
				documentFolder: 'Life/Work',
				startDateProperty: 'parent-item',
				endDateProperty: 'sub-items',
			}),
		).rejects.toThrow(
			'Start date property cannot use a reserved event property.',
		);
		expect(create).not.toHaveBeenCalled();
	});

	it('creates duplicate display titles with different short-ID filenames', async () => {
		const ids = ['7f3A', 'b82D'];
		const { app, create } = createTestApp();
		const service = calendarDocuments(app, () => ids.shift() ?? 'fallback');

		const first = await service.createEvent(calendarConfig(), 'test', '2026-08-21');
		const second = await service.createEvent(calendarConfig(), 'test', '2026-08-21');

		expect(first.path).toBe('Life/Work/test--7f3A.md');
		expect(second.path).toBe('Life/Work/test--b82D.md');
		expect(create).toHaveBeenLastCalledWith(
			'Life/Work/test--b82D.md',
			expect.stringContaining(
				'"title":"test","date":"2026-08-21","status":"Not started","important":false',
			),
		);
	});

	it('creates an empty-titled event with only its unique suffix as the filename', async () => {
		const { app, create } = createTestApp();
		const service = calendarDocuments(app, () => '7f3A');

		const file = await service.createEvent(
			calendarConfig(),
			'',
			'2026-08-21',
		);

		expect(file.path).toBe('Life/Work/--7f3A.md');
		expect(create).toHaveBeenCalledWith(
			'Life/Work/--7f3A.md',
			expect.stringContaining('"title":"","date":"2026-08-21"'),
		);
	});

	it('writes the property values selected in the creation form', async () => {
		const { app, create } = createTestApp();
		const service = calendarDocuments(app, () => '7f3A');

		await service.createEvent(
			calendarConfig(),
			'test',
			'2026-08-21',
			{
				status: 'Done',
				important: true,
				ignored: 'not in the calendar schema',
			},
			'## Agenda\n\n- Review roadmap',
		);

		expect(create).toHaveBeenCalledWith(
			'Life/Work/test--7f3A.md',
			expect.stringContaining(
				'"title":"test","date":"2026-08-21","status":"Done","important":true',
			),
		);
		expect(create.mock.calls[0]?.[1]).not.toContain('ignored');
		expect(create.mock.calls[0]?.[1]).toContain(
			'---\n\n## Agenda\n\n- Review roadmap',
		);
	});

	it('persists one parent item without writing derived sub-items', async () => {
		const { app, create } = createTestApp();
		const service = calendarDocuments(app, () => '7f3A');

		await service.createEvent(calendarConfig(), 'child', '2026-08-21', {
			'parent-item': '  [[Life/Work/parent--2abC]]  ',
			'sub-items': ['[[Life/Work/grandchild--9xyZ]]'],
		});

		const content = create.mock.calls[0]?.[1] as string;
		expect(content).toContain(
			'"parent-item":"[[Life/Work/parent--2abC]]"',
		);
		expect(content).not.toContain('sub-items');
	});

	it('refuses to create an event when a date field conflicts with a fixed relation field', async () => {
		const { app, create, createFolder } = createTestApp();
		const config = {
			...calendarConfig(),
			startDateProperty: 'parent-item',
		};

		await expect(
			calendarDocuments(app).createEvent(
				config,
				'child',
				'2026-08-21',
			),
		).rejects.toThrow(
			'Start date property cannot use a reserved event property.',
		);
		expect(createFolder).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});
});
