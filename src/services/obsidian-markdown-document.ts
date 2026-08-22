import {
	getFrontMatterInfo,
	parseYaml,
	stringifyYaml,
} from 'obsidian';
import {
	markdownBodyParts,
	replaceMarkdownFrontmatterAndBody,
} from '../domain/markdown-document';
import type {
	DecodedMarkdownDocument,
	MarkdownDocumentCodec,
} from './markdown-document';

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class ObsidianMarkdownDocumentCodec implements MarkdownDocumentCodec {
	decode(content: string): DecodedMarkdownDocument {
		const info = getFrontMatterInfo(content);
		if (!info.exists) return { frontmatter: {}, body: content };
		const parsed: unknown = parseYaml(info.frontmatter);
		return {
			frontmatter: isRecord(parsed) ? { ...parsed } : {},
			body: markdownBodyParts(content, info.contentStart).body,
		};
	}

	encode(
		originalContent: string,
		frontmatter: Record<string, unknown>,
		body: string,
	): string {
		const info = getFrontMatterInfo(originalContent);
		return replaceMarkdownFrontmatterAndBody(
			originalContent,
			info,
			stringifyYaml(frontmatter),
			body,
		);
	}
}
