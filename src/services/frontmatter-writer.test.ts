import { describe, expect, it } from 'vitest';
import {
	ExternalModificationError,
	FrontmatterWriter,
	MissingFileError,
	type FrontmatterWritePort,
	type WritableFile,
} from './frontmatter-writer';

type FakeFile = WritableFile;

function createPort(
	frontmatter: Record<string, unknown>,
	file: FakeFile,
): FrontmatterWritePort<FakeFile> {
	return {
		getFileByPath: (path) => (path === file.path ? file : null),
		processFrontMatter: async (_file, mutate) => mutate(frontmatter),
	};
}

describe('safe frontmatter writer', () => {
	it('changes only mapped date fields', async () => {
		const file = { path: 'Task.md', stat: { mtime: 10 } };
		const frontmatter: Record<string, unknown> = {
			title: 'Task',
			date: '2026-08-17',
			'date-end': '2026-08-19',
			status: 'In progress',
			nested: { keep: true },
		};
		const writer = new FrontmatterWriter(createPort(frontmatter, file));

		await writer.updateDateRange(
			'Task.md',
			10,
			{ startProperty: 'date', endProperty: 'date-end' },
			{ start: '2026-08-20', end: '2026-08-22' },
		);

		expect(frontmatter).toEqual({
			title: 'Task',
			date: '2026-08-20',
			'date-end': '2026-08-22',
			status: 'In progress',
			nested: { keep: true },
		});
	});

	it('removes the end field when a range shrinks to one day', async () => {
		const file = { path: 'Task.md', stat: { mtime: 10 } };
		const frontmatter: Record<string, unknown> = {
			date: '2026-08-17',
			'date-end': '2026-08-19',
		};
		const writer = new FrontmatterWriter(createPort(frontmatter, file));

		await writer.updateDateRange(
			'Task.md',
			10,
			{ startProperty: 'date', endProperty: 'date-end' },
			{ start: '2026-08-20' },
		);

		expect(frontmatter).toEqual({ date: '2026-08-20' });
	});

	it('preserves authored ISO times while changing calendar dates', async () => {
		const file = { path: 'Timed.md', stat: { mtime: 10 } };
		const frontmatter: Record<string, unknown> = {
			date: '2026-08-17T09:30:00+08:00',
			'date-end': '2026-08-18T17:45:00+08:00',
		};
		const writer = new FrontmatterWriter(createPort(frontmatter, file));

		await writer.updateDateRange(
			'Timed.md',
			10,
			{ startProperty: 'date', endProperty: 'date-end' },
			{ start: '2026-08-20', end: '2026-08-21' },
		);

		expect(frontmatter).toEqual({
			date: '2026-08-20T09:30:00+08:00',
			'date-end': '2026-08-21T17:45:00+08:00',
		});
	});

	it('cancels a write when the file changed after dragging began', async () => {
		const file = { path: 'Task.md', stat: { mtime: 11 } };
		const frontmatter = { date: '2026-08-17' };
		const writer = new FrontmatterWriter(createPort(frontmatter, file));

		await expect(
			writer.updateDateRange(
				'Task.md',
				10,
				{ startProperty: 'date', endProperty: 'date-end' },
				{ start: '2026-08-20' },
			),
		).rejects.toBeInstanceOf(ExternalModificationError);
		expect(frontmatter.date).toBe('2026-08-17');
	});

	it('re-checks mtime inside the frontmatter transaction', async () => {
		const file = { path: 'Task.md', stat: { mtime: 10 } };
		const frontmatter = { date: '2026-08-17' };
		const port = createPort(frontmatter, file);
		port.processFrontMatter = async (_file, mutate) => {
			file.stat.mtime = 12;
			mutate(frontmatter);
		};
		const writer = new FrontmatterWriter(port);

		await expect(
			writer.updateDateRange(
				'Task.md',
				10,
				{ startProperty: 'date' },
				{ start: '2026-08-20' },
			),
		).rejects.toBeInstanceOf(ExternalModificationError);
	});

	it('updates exactly one property and preserves an explicit None value', async () => {
		const file = { path: 'Task.md', stat: { mtime: 10 } };
		const frontmatter: Record<string, unknown> = {
			title: 'Task',
			date: '2026-08-17',
			status: 'Doing',
			type: 'Task',
			nested: { keep: true },
		};
		const writer = new FrontmatterWriter(createPort(frontmatter, file));

		await writer.updateProperty('Task.md', 10, 'status', 'None');

		expect(frontmatter).toEqual({
			title: 'Task',
			date: '2026-08-17',
			status: 'None',
			type: 'Task',
			nested: { keep: true },
		});
	});

	it('refuses a property update when the file is missing or already changed', async () => {
		const file = { path: 'Task.md', stat: { mtime: 11 } };
		const frontmatter = { status: 'Doing' };
		const writer = new FrontmatterWriter(createPort(frontmatter, file));

		await expect(
			writer.updateProperty('Missing.md', 10, 'status', 'Done'),
		).rejects.toBeInstanceOf(MissingFileError);
		await expect(
			writer.updateProperty('Task.md', 10, 'status', 'Done'),
		).rejects.toBeInstanceOf(ExternalModificationError);
		expect(frontmatter.status).toBe('Doing');
	});

	it('re-checks mtime inside a property update transaction', async () => {
		const file = { path: 'Task.md', stat: { mtime: 10 } };
		const frontmatter = { status: 'Doing' };
		const port = createPort(frontmatter, file);
		port.processFrontMatter = async (_file, mutate) => {
			file.stat.mtime = 12;
			mutate(frontmatter);
		};
		const writer = new FrontmatterWriter(port);

		await expect(
			writer.updateProperty('Task.md', 10, 'status', 'Done'),
		).rejects.toBeInstanceOf(ExternalModificationError);
		expect(frontmatter.status).toBe('Doing');
	});

	it('does not mutate frontmatter when an in-flight property update is aborted', async () => {
		const file = { path: 'Task.md', stat: { mtime: 10 } };
		const frontmatter = { status: 'Doing' };
		const port = createPort(frontmatter, file);
		let runMutation: (() => void) | undefined;
		port.processFrontMatter = (_file, mutate) =>
			new Promise<void>((resolve, reject) => {
				runMutation = () => {
					try {
						mutate(frontmatter);
						resolve();
					} catch (error) {
						reject(error instanceof Error ? error : new Error(String(error)));
					}
				};
			});
		const writer = new FrontmatterWriter(port);
		const controller = new AbortController();

		const write = writer.updateProperty(
			'Task.md',
			10,
			'status',
			'Done',
			controller.signal,
		);
		controller.abort();
		runMutation?.();

		await expect(write).rejects.toMatchObject({ name: 'AbortError' });
		expect(frontmatter.status).toBe('Doing');
	});
});
