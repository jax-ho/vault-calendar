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

	it('derives sub-items from canonical parent links, including unscheduled notes', async () => {
		const parent = fakeFile('Tasks/Parent.md');
		const scheduledChild = fakeFile('Tasks/Scheduled.md');
		const unscheduledChild = fakeFile('Tasks/Unscheduled.md');
		const metadata = new Map<string, Record<string, unknown>>([
			[parent.path, { title: 'Parent', date: '2026-08-17' }],
			[
				scheduledChild.path,
				{
					title: 'Scheduled child',
					date: '2026-08-18',
					'parent-item': '[[Tasks/Parent]]',
				},
			],
			[
				unscheduledChild.path,
				{
					title: 'Unscheduled child',
					'parent-item': '[[Tasks/Parent]]',
				},
			],
		]);
		const port: CalendarIndexPort = {
			configDirectory: '.config',
			getMarkdownFiles: () => [parent, scheduledChild, unscheduledChild],
			getFrontmatter: (file) => metadata.get(file.path),
			resolveLink: (linkPath) =>
				({
					'Tasks/Parent': parent.path,
					'Tasks/Scheduled': scheduledChild.path,
					'Tasks/Unscheduled': unscheduledChild.path,
				}[linkPath]),
		};
		const index = await new CalendarIndexManager(port).acquire(
			config('Tasks/Calendar/_calendar.md'),
		);

		const snapshot = index.snapshot();
		const parentItem = snapshot.items.find((item) => item.path === parent.path);
		const childItem = snapshot.items.find(
			(item) => item.path === scheduledChild.path,
		);
		expect(parentItem?.subItems).toEqual([
			{ path: scheduledChild.path, title: 'Scheduled child' },
			{ path: unscheduledChild.path, title: 'Unscheduled child' },
		]);
		expect(childItem?.parentItem).toEqual({
			path: parent.path,
			title: 'Parent',
		});
		expect(snapshot.issues).toContainEqual(
			expect.objectContaining({
				path: unscheduledChild.path,
				kind: 'missing-date',
			}),
		);
		expect(index.parentCandidatesFor(parent.path)).toEqual([]);
		expect(() =>
			index.validateParentItem(parent.path, '[[Tasks/Parent]]'),
		).toThrow('An item cannot be its own parent.');
		expect(() =>
			index.validateParentItem(parent.path, '[[Tasks/Scheduled]]'),
		).toThrow('A parent item cannot be one of its sub-items.');
		expect(() =>
			index.validateParentItem(parent.path, '[[Outside calendar]]'),
		).not.toThrow();
	});

	it('refreshes cached relationships after Obsidian finishes resolving links', async () => {
		const parent = fakeFile('Tasks/Parent.md');
		const child = fakeFile('Tasks/Child.md');
		const metadata = new Map<string, Record<string, unknown>>([
			[parent.path, { title: 'Parent', date: '2026-08-17' }],
			[
				child.path,
				{
					title: 'Child',
					date: '2026-08-18',
					'parent-item': '[[Parent]]',
				},
			],
		]);
		let resolvedParentPath: string | undefined;
		const getMarkdownFiles = vi.fn(() => [parent, child]);
		const port: CalendarIndexPort = {
			configDirectory: '.config',
			getMarkdownFiles,
			getFrontmatter: (file) => metadata.get(file.path),
			resolveLink: (linkPath) =>
				linkPath === 'Parent' ? resolvedParentPath : undefined,
		};
		const manager = new CalendarIndexManager(port);
		const index = await manager.acquire(config('Tasks/Calendar/_calendar.md'));
		const snapshots: string[][] = [];
		const unsubscribe = index.subscribe((snapshot) => {
			snapshots.push(
				snapshot.items
					.find((item) => item.path === parent.path)
					?.subItems.map((item) => item.path) ?? [],
			);
		});

		expect(snapshots).toEqual([[]]);
		resolvedParentPath = parent.path;
		manager.handleLinksResolved();

		expect(snapshots).toEqual([[], [child.path]]);
		expect(
			index.snapshot().items.find((item) => item.path === child.path)?.parentItem,
		).toEqual({ path: parent.path, title: 'Parent' });
		expect(getMarkdownFiles).toHaveBeenCalledTimes(1);
		unsubscribe();
	});

	it('recomputes both sides when a child is re-parented or removed', async () => {
		const parentA = fakeFile('Tasks/Parent A.md');
		const parentB = fakeFile('Tasks/Parent B.md');
		const child = fakeFile('Tasks/Child.md');
		const files = [parentA, parentB, child];
		const metadata = new Map<string, Record<string, unknown>>([
			[parentA.path, { title: 'Parent A', date: '2026-08-17' }],
			[parentB.path, { title: 'Parent B', date: '2026-08-17' }],
			[
				child.path,
				{
					title: 'Child',
					date: '2026-08-18',
					'parent-item': '[[Parent A]]',
				},
			],
		]);
		const port: CalendarIndexPort = {
			configDirectory: '.config',
			getMarkdownFiles: () => files,
			getFrontmatter: (file) => metadata.get(file.path),
			resolveLink: (linkPath) =>
				({
					'Parent A': parentA.path,
					'Parent B': parentB.path,
				}[linkPath]),
		};
		const manager = new CalendarIndexManager(port);
		const index = await manager.acquire(config('Tasks/Calendar/_calendar.md'));

		metadata.set(child.path, {
			title: 'Child',
			date: '2026-08-18',
			'parent-item': '[[Parent B]]',
		});
		manager.handleFileChanged(child);

		let snapshot = index.snapshot();
		expect(
			snapshot.items.find((item) => item.path === parentA.path)?.subItems,
		).toEqual([]);
		expect(
			snapshot.items.find((item) => item.path === parentB.path)?.subItems,
		).toEqual([{ path: child.path, title: 'Child' }]);

		manager.handleFileDeleted(child.path);
		snapshot = index.snapshot();
		expect(
			snapshot.items.find((item) => item.path === parentB.path)?.subItems,
		).toEqual([]);
	});

	it('reports malformed, self, and cyclic parent items without replacing date issues', async () => {
		const malformed = fakeFile('Tasks/Malformed.md');
		const self = fakeFile('Tasks/Self.md');
		const cycleA = fakeFile('Tasks/Cycle A.md');
		const cycleB = fakeFile('Tasks/Cycle B.md');
		const metadata = new Map<string, Record<string, unknown>>([
			[malformed.path, { date: '2026-08-17', 'parent-item': 'not a link' }],
			[self.path, { date: '2026-08-17', 'parent-item': '[[Tasks/Self]]' }],
			[cycleA.path, { date: '2026-08-17', 'parent-item': '[[Tasks/Cycle B]]' }],
			[
				cycleB.path,
				{ date: 'not-a-date', 'parent-item': '[[Tasks/Cycle A]]' },
			],
		]);
		const port: CalendarIndexPort = {
			configDirectory: '.config',
			getMarkdownFiles: () => [malformed, self, cycleA, cycleB],
			getFrontmatter: (file) => metadata.get(file.path),
			resolveLink: (linkPath) =>
				({
					'Tasks/Self': self.path,
					'Tasks/Cycle A': cycleA.path,
					'Tasks/Cycle B': cycleB.path,
				}[linkPath]),
		};
		const index = await new CalendarIndexManager(port).acquire(
			config('Tasks/Calendar/_calendar.md'),
		);

		const snapshot = index.snapshot();
		const issuesFor = (path: string) =>
			snapshot.issues.filter((issue) => issue.path === path);
		expect(issuesFor(malformed.path)).toEqual([
			{
				path: malformed.path,
				kind: 'invalid-parent-item',
				message: 'Parent item must be one Obsidian wikilink.',
			},
		]);
		expect(issuesFor(self.path)).toEqual([
			{
				path: self.path,
				kind: 'invalid-parent-item',
				message: 'An item cannot be its own parent.',
			},
		]);
		for (const path of [cycleA.path, cycleB.path]) {
			expect(issuesFor(path)).toContainEqual({
				path,
				kind: 'invalid-parent-item',
				message: 'Parent item relationships cannot form a cycle.',
			});
		}
		expect(issuesFor(cycleB.path)).toContainEqual({
			path: cycleB.path,
			kind: 'invalid-start',
			message: 'date is not a supported date.',
		});
	});
});
