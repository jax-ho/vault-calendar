import { describe, expect, it } from 'vitest';
import {
	markdownBodyParts,
	replaceMarkdownFrontmatterAndBody,
} from './markdown-document';

describe('event Markdown document encoding', () => {
	it('keeps the closing frontmatter delimiter on its own line', () => {
		const original = '---\ntitle: hello\ndate: 2026-06-18\n---\nBody';
		const closing = original.indexOf('---', 3);
		const result = replaceMarkdownFrontmatterAndBody(
			original,
			{ exists: true, from: 4, to: closing, contentStart: closing + 3 },
			'title: changed\ndate: 2026-06-18\n',
			'Updated body',
		);

		expect(result).toBe(
			'---\ntitle: changed\ndate: 2026-06-18\n---\nUpdated body',
		);
	});

	it('hides structural blank lines from the editable body and restores them', () => {
		const original = '---\ntitle: hello\n---\n\nBody';
		const closing = original.indexOf('---', 3);
		const parts = markdownBodyParts(original, closing + 3);
		expect(parts).toEqual({ prefix: '\n\n', body: 'Body' });
		expect(
			replaceMarkdownFrontmatterAndBody(
				original,
				{ exists: true, from: 4, to: closing, contentStart: closing + 3 },
				'title: hello',
				'Changed',
			),
		).toBe('---\ntitle: hello\n---\n\nChanged');
	});
});
