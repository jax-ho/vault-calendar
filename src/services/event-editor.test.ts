import { describe, expect, it } from 'vitest';
import type { EventFieldMapping } from '../domain/event-edit';
import { ExternalModificationError } from './frontmatter-writer';
import {
	EventEditorService,
	type EventEditorPort,
} from './event-editor';
import type { MarkdownDocumentCodec } from './markdown-document';

interface FakeFile {
	path: string;
	content: string;
}

const mapping: EventFieldMapping = {
	startDateProperty: 'date',
	endDateProperty: 'date-end',
	visibleProperties: ['status'],
	propertyDefinitions: {
		status: { type: 'select', options: ['Open', 'Done'] },
	},
};

const codec: MarkdownDocumentCodec = {
	decode: (content) => JSON.parse(content) as { frontmatter: Record<string, unknown>; body: string },
	encode: (_content, frontmatter, body) => JSON.stringify({ frontmatter, body }),
};

function createPort(file: FakeFile): EventEditorPort<FakeFile> {
	return {
		getFileByPath: (path) => (path === file.path ? file : null),
		read: async (target) => target.content,
		process: async (target, mutate) => {
			target.content = mutate(target.content);
			return target.content;
		},
	};
}

describe('event editor service', () => {
	it('loads and atomically saves frontmatter and body', async () => {
		const file: FakeFile = {
			path: 'Work/Launch.md',
			content: JSON.stringify({
				frontmatter: { title: 'Launch', date: '2026-08-20', status: 'Open' },
				body: 'Initial body',
			}),
		};
		const service = new EventEditorService(createPort(file), codec);
		const session = await service.load(file.path, mapping, {
			title: 'Fallback',
			start: '2026-08-20',
		});
		const saved = await service.save(session, mapping, {
			...session.draft,
			title: 'Launch review',
			properties: { status: 'Done' },
			body: 'Updated body',
		});

		expect(JSON.parse(file.content)).toEqual({
			frontmatter: { title: 'Launch review', date: '2026-08-20', status: 'Done' },
			body: 'Updated body',
		});
		expect(saved.baselineContent).toBe(file.content);
	});

	it('refuses to overwrite content changed outside the modal', async () => {
		const file: FakeFile = {
			path: 'Work/Launch.md',
			content: JSON.stringify({
				frontmatter: { title: 'Launch', date: '2026-08-20' },
				body: 'Initial body',
			}),
		};
		const service = new EventEditorService(createPort(file), codec);
		const session = await service.load(file.path, mapping, {
			title: 'Fallback',
			start: '2026-08-20',
		});
		file.content = JSON.stringify({
			frontmatter: { title: 'External edit', date: '2026-08-20' },
			body: 'Initial body',
		});

		await expect(
			service.save(session, mapping, { ...session.draft, title: 'Modal edit' }),
		).rejects.toBeInstanceOf(ExternalModificationError);
		expect(file.content).toContain('External edit');
		expect(file.content).not.toContain('Modal edit');
	});
});
