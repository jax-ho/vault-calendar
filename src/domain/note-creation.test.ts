import { describe, expect, it } from 'vitest';
import {
	calendarFolderPath,
	FileAlreadyExistsError,
	sanitizeNoteName,
	uniqueEventMarkdownPath,
	uniqueMarkdownPath,
} from './note-creation';

describe('note creation paths', () => {
	it('sanitizes unsafe filename characters without changing the note title property', () => {
		expect(sanitizeNoteName('Release: plan / draft?')).toBe('Release plan draft');
	});

	it('never chooses an existing file path', () => {
		expect(() =>
			uniqueMarkdownPath('Existing', 'Tasks', (path) => path === 'Tasks/Existing.md'),
		).toThrow(FileAlreadyExistsError);
	});

	it('returns an exact available Markdown path instead of auto-overwriting', () => {
		expect(uniqueMarkdownPath('New task', 'Tasks', () => false)).toBe('Tasks/New task.md');
	});

	it('creates a dedicated calendar folder beneath the selected parent folder', () => {
		expect(calendarFolderPath('Work', 'Life')).toBe('Life/Work');
		expect(calendarFolderPath('Work', '')).toBe('Work');
	});

	it('uses a stable-looking short ID so duplicate event titles get different paths', () => {
		const ids = ['7f3A', 'b82D'];
		const createId = () => ids.shift() ?? 'fallback';
		const existing = new Set(['Life/Work/test--7f3A.md']);

		expect(
			uniqueEventMarkdownPath(
				'test',
				'Life/Work',
				(path) => existing.has(path),
				createId,
			),
		).toBe('Life/Work/test--b82D.md');
	});

	it('uses only the unique suffix when the event title is empty', () => {
		expect(
			uniqueEventMarkdownPath('', 'Life/Work', () => false, () => '7f3A'),
		).toBe('Life/Work/--7f3A.md');
		expect(
			uniqueEventMarkdownPath('///', 'Life/Work', () => false, () => 'b82D'),
		).toBe('Life/Work/--b82D.md');
	});

	it('generates a four-character ID from digits and mixed-case letters', () => {
		expect(uniqueEventMarkdownPath('test', 'Life/Work', () => false)).toMatch(
			/^Life\/Work\/test--[0-9A-Za-z]{4}\.md$/u,
		);
	});
});
