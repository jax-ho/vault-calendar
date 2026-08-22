import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarConfig } from '../types';

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
	normalizePath: (path: string) => path,
	stringifyYaml: (frontmatter: Record<string, unknown>) => `${JSON.stringify(frontmatter)}\n`,
	TFile: obsidianClasses.MockFile,
	TFolder: obsidianClasses.MockFolder,
}));

import { CalendarDocumentService, type CreateCalendarInput } from './calendar-document';

function createTestApp(): {
	app: App;
	create: ReturnType<typeof vi.fn>;
	createFolder: ReturnType<typeof vi.fn>;
} {
	const entries = new Map<string, unknown>();
	const createFolder = vi.fn(async (path: string) => {
		entries.set(path, new obsidianClasses.MockFolder(path));
	});
	const create = vi.fn(async (path: string, content: string) => {
		const file = new obsidianClasses.MockFile(path);
		entries.set(path, file);
		return file;
	});
	const app = {
		vault: {
			create,
			createFolder,
			getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
		},
	} as unknown as App;
	return { app, create, createFolder };
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
		weekStartsOn: 'monday',
		layout: 'month',
		openBehavior: 'same-leaf',
		createFolder: 'Life/Work',
		excludePaths: [],
	};
}

describe('calendar document file layout', () => {
	it('stores the calendar definition inside its dedicated folder', async () => {
		const { app, create, createFolder } = createTestApp();
		const input: CreateCalendarInput = {
			name: 'Work',
			documentFolder: 'Life/Work',
			startDateProperty: 'date',
			endDateProperty: 'date-end',
		};

		const file = await new CalendarDocumentService(app).create(input);

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
		expect(create.mock.calls[0]?.[1]).not.toContain('calendar-title-property');
		expect(create.mock.calls[0]?.[1]).not.toContain('"Important"');
		expect(create.mock.calls[0]?.[1]).not.toContain('calendar-source');
		expect(create.mock.calls[0]?.[1]).not.toContain('calendar-create-folder');
	});

	it('refuses to create a root-level _calendar.md without a calendar folder', async () => {
		const { app } = createTestApp();
		await expect(
			new CalendarDocumentService(app).create({
				name: 'Work',
				documentFolder: '',
				startDateProperty: 'date',
				endDateProperty: 'date-end',
			}),
		).rejects.toThrow('Calendars require a dedicated folder.');
	});

	it('creates duplicate display titles with different short-ID filenames', async () => {
		const ids = ['7f3A', 'b82D'];
		const { app, create } = createTestApp();
		const service = new CalendarDocumentService(app, () => ids.shift() ?? 'fallback');

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

	it('writes the property values selected in the creation form', async () => {
		const { app, create } = createTestApp();
		const service = new CalendarDocumentService(app, () => '7f3A');

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
});
