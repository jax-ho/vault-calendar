import { describe, expect, it, vi } from 'vitest';
import { applyCalendarConfigWithSavedViewsToFrontmatter } from '../domain/config';
import type { CalendarConfig } from '../types';
import { CalendarConfigMutationCoordinator } from './calendar-config-mutation-coordinator';
import {
	CalendarPropertyMigrationService,
	type CalendarPropertyMigrationPort,
} from './calendar-property-migration';
import type { MarkdownDocumentCodec } from './markdown-document';

interface FakeFile {
	path: string;
	content: string;
}

interface FakeDocument {
	frontmatter: Record<string, unknown>;
	body: string;
}

const codec: MarkdownDocumentCodec = {
	decode: (content) => JSON.parse(content) as FakeDocument,
	encode: (_content, frontmatter, body) => JSON.stringify({ frontmatter, body }),
};

function document(
	frontmatter: Record<string, unknown>,
	body = '',
): string {
	return JSON.stringify({ frontmatter, body });
}

function config(): CalendarConfig {
	return {
		documentPath: 'Life/Work/_calendar.md',
		name: 'Work',
		sourceFolder: 'Life/Work',
		recursive: true,
		startDateProperty: 'date',
		endDateProperty: 'date-end',
		visibleProperties: ['Status', 'Type'],
		propertyDefinitions: {
			Status: {
				type: 'select',
				options: ['None', 'Open', 'Done'],
				colors: { None: 'default', Open: 'blue', Done: 'green' },
				default: 'Open',
			},
			Type: { type: 'select', options: ['None', 'Task'], default: 'Task' },
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
						name: 'Calendar view',
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

function calendarDocument(
	calendarConfig: CalendarConfig = config(),
	overrides: Record<string, unknown> = {},
	body = '',
): string {
	const frontmatter: Record<string, unknown> = {};
	applyCalendarConfigWithSavedViewsToFrontmatter(frontmatter, calendarConfig);
	Object.assign(frontmatter, overrides);
	return document(frontmatter, body);
}

function createPort(
	files: FakeFile[],
	failPath?: string,
): CalendarPropertyMigrationPort<FakeFile> {
	return {
		configDirectory: '.config',
		getMarkdownFiles: () => files,
		getFileByPath: (path) => files.find((file) => file.path === path) ?? null,
		read: async (file) => file.content,
		process: async (file, mutate) => {
			if (file.path === failPath) throw new Error(`Write failed: ${file.path}`);
			file.content = mutate(file.content);
			return file.content;
		},
	};
}

function decoded(file: FakeFile): FakeDocument {
	return JSON.parse(file.content) as FakeDocument;
}

function migrationService(
	port: CalendarPropertyMigrationPort<FakeFile>,
): CalendarPropertyMigrationService<FakeFile> {
	return new CalendarPropertyMigrationService(
		port,
		codec,
		new CalendarConfigMutationCoordinator(),
	);
}

describe('calendar property migration', () => {
	it('renames the schema and every matching event key in the calendar source', async () => {
		const calendar = {
			path: 'Life/Work/_calendar.md',
			content: calendarDocument(config(), { custom: 'preserved' }, 'Calendar notes'),
		};
		const matching = {
			path: 'Life/Work/Launch.md',
			content: document(
				{ title: 'Launch', date: '2026-08-22', Status: 'Done', untouched: 3 },
				'Event body',
			),
		};
		const missing = {
			path: 'Life/Work/No status.md',
			content: document({ title: 'No status', date: '2026-08-23' }),
		};
		const nestedCalendar = {
			path: 'Life/Work/Nested/_calendar.md',
			content: document({ Status: 'Open' }),
		};
		const outside = {
			path: 'Life/Personal.md',
			content: document({ Status: 'Open' }),
		};
		const missingOriginal = missing.content;
		const nestedOriginal = nestedCalendar.content;
		const outsideOriginal = outside.content;
		const files = [calendar, matching, missing, nestedCalendar, outside];
		const service = migrationService(createPort(files));

		const nextConfig = await service.rename(config(), 'Status', 'State', {
			type: 'select',
			options: ['None', 'Open', 'Done'],
			colors: { None: 'default', Open: 'yellow', Done: 'green' },
			default: 'Open',
		});

		expect(nextConfig.visibleProperties).toEqual(['State', 'Type']);
		expect(nextConfig.cardColorProperty).toBe('State');
		expect(nextConfig.propertyDefinitions.State?.colors?.Open).toBe('yellow');
		expect(nextConfig.propertyDefinitions.Status).toBeUndefined();
		expect(decoded(matching)).toEqual({
			frontmatter: {
				title: 'Launch',
				date: '2026-08-22',
				State: 'Done',
				untouched: 3,
			},
			body: 'Event body',
		});
		expect(missing.content).toBe(missingOriginal);
		expect(nestedCalendar.content).toBe(nestedOriginal);
		expect(outside.content).toBe(outsideOriginal);
		expect(decoded(calendar).frontmatter.custom).toBe('preserved');
		expect(
			(decoded(calendar).frontmatter['calendar-properties'] as Record<string, unknown>)
				.State,
		).toBeDefined();
		expect(decoded(calendar).frontmatter['calendar-views']).toEqual([
			expect.objectContaining({ id: 'calendar' }),
			expect.objectContaining({ id: 'board', 'group-by': 'State' }),
		]);
	});

	it('rejects a conflicting event before writing any file', async () => {
		const calendar = {
			path: 'Life/Work/_calendar.md',
			content: calendarDocument(),
		};
		const first = {
			path: 'Life/Work/A.md',
			content: document({ date: '2026-08-22', Status: 'Open' }),
		};
		const conflict = {
			path: 'Life/Work/B.md',
			content: document({ date: '2026-08-23', Status: 'Done', State: 'Manual' }),
		};
		const originals = [calendar, first, conflict].map((file) => file.content);
		const service = migrationService(createPort([calendar, first, conflict]));

		await expect(
			service.rename(config(), 'Status', 'State', {
				type: 'select',
				options: ['None', 'Open', 'Done'],
			}),
		).rejects.toThrow('B.md already contains State');
		expect([calendar, first, conflict].map((file) => file.content)).toEqual(originals);
	});

	it('rolls back event files when the calendar schema cannot be saved', async () => {
		const calendar = {
			path: 'Life/Work/_calendar.md',
			content: calendarDocument(),
		};
		const first = {
			path: 'Life/Work/A.md',
			content: document({ date: '2026-08-22', Status: 'Open' }),
		};
		const second = {
			path: 'Life/Work/B.md',
			content: document({ date: '2026-08-23', Status: 'Done' }),
		};
		const originals = [calendar, first, second].map((file) => file.content);
		const service = migrationService(
			createPort([calendar, first, second], calendar.path),
		);

		await expect(
			service.rename(config(), 'Status', 'State', {
				type: 'select',
				options: ['None', 'Open', 'Done'],
			}),
		).rejects.toThrow('Write failed');
		expect([calendar, first, second].map((file) => file.content)).toEqual(originals);
	});

	it('renames Board references in the latest catalog without dropping views absent from the stale input', async () => {
		const staleConfig = config();
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
							name: 'Added elsewhere',
							type: 'board',
							groupBy: 'Status',
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
		const calendar = {
			path: latestConfig.documentPath,
			content: calendarDocument(latestConfig),
		};
		const event = {
			path: 'Life/Work/A.md',
			content: document({ date: '2026-08-22', Status: 'Open' }),
		};
		const service = migrationService(createPort([calendar, event]));

		const nextConfig = await service.rename(staleConfig, 'Status', 'State', {
			type: 'select',
			options: ['None', 'Open', 'Done'],
		});

		expect(
			nextConfig.viewCatalog?.entries.map((entry) =>
				entry.kind === 'valid' && entry.definition.type === 'board'
					? [entry.definition.id, entry.definition.groupBy]
					: undefined,
			).filter(Boolean),
		).toEqual([
			['board', 'State'],
			['new-board', 'State'],
			['stale-board', 'ArchivedStage'],
		]);
		expect(decoded(calendar).frontmatter['calendar-views']).toEqual([
			expect.objectContaining({ id: 'calendar' }),
			expect.objectContaining({ id: 'board', 'group-by': 'State' }),
			expect.objectContaining({ id: 'new-board', 'group-by': 'State' }),
			expect.objectContaining({
				id: 'stale-board',
				'group-by': 'ArchivedStage',
			}),
		]);
	});

	it('rejects a stale definition before renaming events or the calendar schema', async () => {
		const staleConfig = config();
		const latestConfig: CalendarConfig = {
			...staleConfig,
			propertyDefinitions: {
				...staleConfig.propertyDefinitions,
				Status: {
					...staleConfig.propertyDefinitions.Status!,
					options: ['None', 'Open', 'Blocked', 'Done'],
				},
			},
		};
		const calendar = {
			path: latestConfig.documentPath,
			content: calendarDocument(latestConfig),
		};
		const event = {
			path: 'Life/Work/A.md',
			content: document({ date: '2026-08-22', Status: 'Open' }),
		};
		const originals = [calendar, event].map((file) => file.content);
		const port = createPort([calendar, event]);
		const process = vi.spyOn(port, 'process');
		const service = migrationService(port);

		await expect(
			service.rename(staleConfig, 'Status', 'State', {
				type: 'select',
				options: ['None', 'Open', 'Done'],
			}),
		).rejects.toThrow('changed after the interaction started');

		expect(process).not.toHaveBeenCalled();
		expect([calendar, event].map((file) => file.content)).toEqual(originals);
	});

	it('fails closed before touching events when the latest catalog is structurally invalid', async () => {
		const calendar = {
			path: config().documentPath,
			content: calendarDocument(config(), {
				'calendar-views': [
					{
						id: 'duplicate',
						name: 'Calendar',
						type: 'calendar',
						layout: 'month',
						'week-starts-on': 'locale',
					},
					{
						id: 'duplicate',
						name: 'Board',
						type: 'board',
						'group-by': 'Status',
					},
				],
			}),
		};
		const event = {
			path: 'Life/Work/A.md',
			content: document({ date: '2026-08-22', Status: 'Open' }),
		};
		const originals = [calendar, event].map((file) => file.content);
		const port = createPort([calendar, event]);
		const process = vi.spyOn(port, 'process');
		const service = migrationService(port);

		await expect(
			service.rename(config(), 'Status', 'State', {
				type: 'select',
				options: ['None', 'Open', 'Done'],
			}),
		).rejects.toThrow('saved-view catalog is structurally invalid');

		expect(process).not.toHaveBeenCalled();
		expect([calendar, event].map((file) => file.content)).toEqual(originals);
	});

	it('queues the whole migration behind other writes for the same calendar document', async () => {
		const calendar = {
			path: config().documentPath,
			content: calendarDocument(),
		};
		const event = {
			path: 'Life/Work/A.md',
			content: document({ date: '2026-08-22', Status: 'Open' }),
		};
		const port = createPort([calendar, event]);
		const read = vi.spyOn(port, 'read');
		const coordinator = new CalendarConfigMutationCoordinator();
		let releaseBlocker = (): void => undefined;
		let markBlockerStarted = (): void => undefined;
		const blockerStarted = new Promise<void>((resolve) => {
			markBlockerStarted = resolve;
		});
		const blocker = coordinator.run(calendar.path, async () => {
			markBlockerStarted();
			await new Promise<void>((resolve) => {
				releaseBlocker = resolve;
			});
		});
		await blockerStarted;
		const service = new CalendarPropertyMigrationService(port, codec, coordinator);

		const migration = service.rename(config(), 'Status', 'State', {
			type: 'select',
			options: ['None', 'Open', 'Done'],
		});
		await Promise.resolve();
		expect(read).not.toHaveBeenCalled();

		releaseBlocker();
		await blocker;
		await migration;
		expect(read).toHaveBeenCalled();
		expect(decoded(event).frontmatter.State).toBe('Open');
	});
});
