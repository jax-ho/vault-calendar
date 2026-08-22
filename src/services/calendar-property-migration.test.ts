import { describe, expect, it } from 'vitest';
import type { CalendarConfig } from '../types';
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
		weekStartsOn: 'monday',
		layout: 'month',
		openBehavior: 'same-leaf',
		createFolder: 'Life/Work',
		excludePaths: [],
	};
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

describe('calendar property migration', () => {
	it('renames the schema and every matching event key in the calendar source', async () => {
		const calendar = {
			path: 'Life/Work/_calendar.md',
			content: document({ 'calendar-view': true, custom: 'preserved' }, 'Calendar notes'),
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
		const service = new CalendarPropertyMigrationService(createPort(files), codec);

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
	});

	it('rejects a conflicting event before writing any file', async () => {
		const calendar = {
			path: 'Life/Work/_calendar.md',
			content: document({ 'calendar-view': true }),
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
		const service = new CalendarPropertyMigrationService(
			createPort([calendar, first, conflict]),
			codec,
		);

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
			content: document({ 'calendar-view': true }),
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
		const service = new CalendarPropertyMigrationService(
			createPort([calendar, first, second], calendar.path),
			codec,
		);

		await expect(
			service.rename(config(), 'Status', 'State', {
				type: 'select',
				options: ['None', 'Open', 'Done'],
			}),
		).rejects.toThrow('Write failed');
		expect([calendar, first, second].map((file) => file.content)).toEqual(originals);
	});
});
