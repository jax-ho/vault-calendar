export interface DecodedMarkdownDocument {
	frontmatter: Record<string, unknown>;
	body: string;
}

export interface MarkdownDocumentCodec {
	decode(content: string): DecodedMarkdownDocument;
	encode(
		originalContent: string,
		frontmatter: Record<string, unknown>,
		body: string,
	): string;
}
