export interface FrontmatterOffsets {
	exists: boolean;
	from: number;
	to: number;
	contentStart: number;
}

function lineEnding(content: string): string {
	return content.includes('\r\n') ? '\r\n' : '\n';
}

export function markdownBodyParts(
	content: string,
	contentStart: number,
): { prefix: string; body: string } {
	const tail = content.slice(contentStart);
	const prefix = /^(?:\r?\n){0,2}/u.exec(tail)?.[0] ?? '';
	return { prefix, body: tail.slice(prefix.length) };
}

export function replaceMarkdownFrontmatterAndBody(
	originalContent: string,
	info: FrontmatterOffsets,
	serializedFrontmatter: string,
	body: string,
): string {
	const newline = lineEnding(originalContent);
	const yaml = `${serializedFrontmatter.trimEnd().replaceAll('\n', newline)}${newline}`;
	if (!info.exists) return `---${newline}${yaml}---${newline}${newline}${body}`;
	const { prefix } = markdownBodyParts(originalContent, info.contentStart);
	return `${originalContent.slice(0, info.from)}${yaml}${originalContent.slice(info.to, info.contentStart)}${prefix}${body}`;
}
