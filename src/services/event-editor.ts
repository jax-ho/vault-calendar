import {
	applyEventEditDraft,
	copyEventEditDraft,
	createEventEditDraft,
	validateEventEditDraft,
	type EventEditDraft,
	type EventFieldMapping,
} from '../domain/event-edit';
import { ExternalModificationError, MissingFileError } from './frontmatter-writer';
import type { MarkdownDocumentCodec } from './markdown-document';

export interface EventEditableFile {
	path: string;
}

export interface EventEditorPort<TFile extends EventEditableFile> {
	getFileByPath(path: string): TFile | null;
	read(file: TFile): Promise<string>;
	process(file: TFile, mutate: (content: string) => string): Promise<string>;
}

export interface EventEditSession {
	path: string;
	baselineContent: string;
	draft: EventEditDraft;
}

export class EventEditorService<TFile extends EventEditableFile> {
	constructor(
		private readonly port: EventEditorPort<TFile>,
		private readonly codec: MarkdownDocumentCodec,
	) {}

	async load(
		path: string,
		mapping: EventFieldMapping,
		fallback: { title: string; start: string },
	): Promise<EventEditSession> {
		const file = this.port.getFileByPath(path);
		if (!file) throw new MissingFileError(path);
		const content = await this.port.read(file);
		const decoded = this.codec.decode(content);
		return {
			path,
			baselineContent: content,
			draft: createEventEditDraft(
				decoded.frontmatter,
				decoded.body,
				mapping,
				fallback,
			),
		};
	}

	async save(
		session: EventEditSession,
		mapping: EventFieldMapping,
		draft: EventEditDraft,
	): Promise<EventEditSession> {
		validateEventEditDraft(draft, mapping);
		const file = this.port.getFileByPath(session.path);
		if (!file) throw new MissingFileError(session.path);
		const written = await this.port.process(file, (currentContent) => {
			if (currentContent !== session.baselineContent) {
				throw new ExternalModificationError(session.path);
			}
			const decoded = this.codec.decode(currentContent);
			applyEventEditDraft(decoded.frontmatter, draft, mapping);
			return this.codec.encode(currentContent, decoded.frontmatter, draft.body);
		});
		return {
			path: session.path,
			baselineContent: written,
			draft: copyEventEditDraft(draft),
		};
	}
}
