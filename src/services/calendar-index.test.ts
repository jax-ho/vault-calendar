import { describe, expect, it, vi } from 'vitest';
import type { CalendarConfig } from '../types';
import {
	CalendarIndexManager,
	type CalendarIndexFile,
	type CalendarIndexPort,
} from './calendar-index';

function config(documentPath: string): CalendarConfig {
	return {
		documentPath,
		name: documentPath,
		sourceFolder: 'Tasks',
		recursive: true,
		startDateProperty: 'date',
		endDateProperty: 'date-end',
		visibleProperties: [],
		propertyDefinitions: {},
		weekStartsOn: 'monday',
		layout: 'month',
		openBehavior: 'same-leaf',
		createFolder: 'Tasks',
		excludePaths: [],
	};
}

function fakeFile(path: string, mtime = 1): CalendarIndexFile {
	const name = path.split('/').at(-1) ?? path;
	return {
		path,
		basename: name.replace(/\.md$/u, ''),
		stat: { mtime },
	};
}

describe('incremental calendar indexes', () => {
	it('updates the same event in every referencing calendar without rescanning the vault', async () => {
		const event = fakeFile('Tasks/Shared.md');
		const files = [event];
		const metadata = new Map<string, Record<string, unknown>>([
			['Tasks/Shared.md', { frontmatter: { title: 'Shared', date: '2026-08-17' } }],
		]);
		const getMarkdownFiles = vi.fn(() => files);
		const port: CalendarIndexPort = {
			configDirectory: '.config',
			getMarkdownFiles,
			getFrontmatter: (file) => metadata.get(file.path)?.frontmatter as
				| Record<string, unknown>
				| undefined,
		};
		const manager = new CalendarIndexManager(port);
		const work = await manager.acquire(config('Calendars/Work/_calendar.md'));
		const learning = await manager.acquire(config('Calendars/Learning/_calendar.md'));
		expect(getMarkdownFiles).toHaveBeenCalledTimes(2);
		expect(work.snapshot().items[0]?.start).toBe('2026-08-17');
		expect(learning.snapshot().items[0]?.start).toBe('2026-08-17');

		metadata.set('Tasks/Shared.md', {
			frontmatter: { title: 'Shared', date: '2026-08-18' },
		});
		manager.handleFileChanged(event);

		expect(work.snapshot().items[0]?.start).toBe('2026-08-18');
		expect(learning.snapshot().items[0]?.start).toBe('2026-08-18');
		expect(getMarkdownFiles).toHaveBeenCalledTimes(2);
	});

	it('updates path identity on rename and removes it on delete', async () => {
		const event = fakeFile('Tasks/Old.md');
		const metadata = new Map<string, Record<string, unknown>>([
			['Tasks/Old.md', { frontmatter: { date: '2026-08-17' } }],
		]);
		const port: CalendarIndexPort = {
			configDirectory: '.config',
			getMarkdownFiles: () => [event],
			getFrontmatter: (file) => metadata.get(file.path)?.frontmatter as
				| Record<string, unknown>
				| undefined,
		};
		const manager = new CalendarIndexManager(port);
		const index = await manager.acquire(config('Tasks/Calendar/_calendar.md'));
		const renamed = fakeFile('Tasks/New.md', 2);
		metadata.set('Tasks/New.md', { frontmatter: { date: '2026-08-17' } });

		manager.handleFileRenamed(renamed, 'Tasks/Old.md');
		expect(index.snapshot().items.map((item) => item.path)).toEqual(['Tasks/New.md']);
		manager.handleFileDeleted('Tasks/New.md');
		expect(index.snapshot().items).toEqual([]);
	});

	it('excludes canonical _calendar.md files without treating legacy markers specially', async () => {
		const valid = fakeFile('Tasks/Valid/_calendar.md');
		const incomplete = fakeFile('Tasks/Incomplete/_calendar.md');
		const legacy = fakeFile('Tasks/Legacy calendar.md');
		const event = fakeFile('Tasks/Event.md');
		const metadata = new Map<string, Record<string, unknown>>([
			['Tasks/Valid/_calendar.md', { frontmatter: { 'calendar-view': true, date: '2026-08-17' } }],
			['Tasks/Incomplete/_calendar.md', { frontmatter: { date: '2026-08-17' } }],
			['Tasks/Legacy calendar.md', { frontmatter: { 'calendar-view': true, date: '2026-08-17' } }],
			['Tasks/Event.md', { frontmatter: { date: '2026-08-17' } }],
		]);
		const port: CalendarIndexPort = {
			configDirectory: '.config',
			getMarkdownFiles: () => [valid, incomplete, legacy, event],
			getFrontmatter: (file) => metadata.get(file.path)?.frontmatter as
				| Record<string, unknown>
				| undefined,
		};
		const manager = new CalendarIndexManager(port);
		const index = await manager.acquire(config('Tasks/Calendar/_calendar.md'));

		expect(index.snapshot().items.map((item) => item.path)).toEqual([
			'Tasks/Event.md',
			'Tasks/Legacy calendar.md',
		]);
	});

	it('keeps the last good snapshot when a full rebuild fails', async () => {
		const event = fakeFile('Tasks/Event.md');
		let shouldFail = false;
		const port: CalendarIndexPort = {
			configDirectory: '.config',
			getMarkdownFiles: () => {
				if (shouldFail) throw new Error('Fixture scan failed');
				return [event];
			},
			getFrontmatter: () => ({ date: '2026-08-17' }),
		};
		const manager = new CalendarIndexManager(port);
		const index = await manager.acquire(config('Tasks/Calendar/_calendar.md'));
		const nextConfig = {
			...config('Tasks/Calendar/_calendar.md'),
			sourceFolder: 'Tasks/New source',
		};
		shouldFail = true;

		await expect(manager.updateConfig(nextConfig)).rejects.toThrow('Fixture scan failed');
		expect(index.snapshot().items.map((item) => item.path)).toEqual(['Tasks/Event.md']);

		shouldFail = false;
		await manager.updateConfig(nextConfig);
		expect(index.snapshot().items).toEqual([]);
	});

	it('reprojects events when property schema changes', async () => {
		const event = fakeFile('Tasks/Event.md');
		const getMarkdownFiles = vi.fn(() => [event]);
		const port: CalendarIndexPort = {
			configDirectory: '.config',
			getMarkdownFiles,
			getFrontmatter: () => ({ date: '2026-08-17', Status: 'Removed' }),
		};
		const initial = config('Tasks/Calendar/_calendar.md');
		initial.visibleProperties = ['Status'];
		initial.propertyDefinitions = {
			Status: { type: 'select', options: ['None', 'Removed'] },
		};
		const manager = new CalendarIndexManager(port);
		const index = await manager.acquire(initial);
		expect(index.snapshot().items[0]?.properties.Status).toBe('Removed');

		await manager.updateConfig({
			...initial,
			propertyDefinitions: {
				Status: { type: 'select', options: ['None', 'Open'] },
			},
		});

		expect(index.snapshot().items[0]?.properties.Status).toBe('None');
		expect(getMarkdownFiles).toHaveBeenCalledTimes(2);
	});
});
