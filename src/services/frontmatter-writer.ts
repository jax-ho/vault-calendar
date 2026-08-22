import type { DateRange } from '../domain/interactions';
import {
	applyDateRangeMutation,
	type DateFieldMapping,
} from '../domain/frontmatter-mutation';

export interface WritableFile {
	path: string;
	stat: { mtime: number };
}

export interface FrontmatterWritePort<TFile extends WritableFile> {
	getFileByPath(path: string): TFile | null;
	processFrontMatter(
		file: TFile,
		mutate: (frontmatter: Record<string, unknown>) => void,
	): Promise<void>;
}

export class ExternalModificationError extends Error {
	constructor(path: string) {
		super(`${path} changed after the interaction started. Try again.`);
		this.name = 'ExternalModificationError';
	}
}

export class MissingFileError extends Error {
	constructor(path: string) {
		super(`${path} no longer exists.`);
		this.name = 'MissingFileError';
	}
}

export class FrontmatterWriter<TFile extends WritableFile> {
	constructor(private readonly port: FrontmatterWritePort<TFile>) {}

	async updateDateRange(
		path: string,
		expectedMtime: number,
		mapping: DateFieldMapping,
		nextRange: DateRange,
	): Promise<void> {
		const file = this.port.getFileByPath(path);
		if (!file) throw new MissingFileError(path);
		if (file.stat.mtime !== expectedMtime) throw new ExternalModificationError(path);
		await this.port.processFrontMatter(file, (frontmatter) => {
			if (file.stat.mtime !== expectedMtime) throw new ExternalModificationError(path);
			applyDateRangeMutation(frontmatter, mapping, nextRange);
		});
	}
}
