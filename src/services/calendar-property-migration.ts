import {
	applyCalendarConfigToFrontmatter,
	isCalendarDocumentPath,
} from '../domain/config';
import {
	renameCalendarProperty,
	updateCalendarProperty,
	validatePropertyName,
} from '../domain/property-schema';
import { isPathInCalendarSource } from '../domain/source-scope';
import type {
	CalendarConfig,
	CalendarPropertyDefinition,
} from '../types';
import { ExternalModificationError, MissingFileError } from './frontmatter-writer';
import type { MarkdownDocumentCodec } from './markdown-document';

export interface CalendarPropertyMigrationFile {
	path: string;
}

export interface CalendarPropertyMigrationPort<
	TFile extends CalendarPropertyMigrationFile,
> {
	configDirectory: string;
	getMarkdownFiles(): TFile[];
	getFileByPath(path: string): TFile | null;
	read(file: TFile): Promise<string>;
	process(file: TFile, mutate: (content: string) => string): Promise<string>;
}

interface FileChange<TFile extends CalendarPropertyMigrationFile> {
	file: TFile;
	originalContent: string;
	nextContent: string;
	writtenContent?: string;
}

function hasOwn(frontmatter: Record<string, unknown>, property: string): boolean {
	return Object.prototype.hasOwnProperty.call(frontmatter, property);
}

export class CalendarPropertyMigrationService<
	TFile extends CalendarPropertyMigrationFile,
> {
	constructor(
		private readonly port: CalendarPropertyMigrationPort<TFile>,
		private readonly codec: MarkdownDocumentCodec,
	) {}

	async rename(
		config: CalendarConfig,
		currentName: string,
		nextName: string,
		definition: CalendarPropertyDefinition,
	): Promise<CalendarConfig> {
		const property = validatePropertyName(
			config.propertyDefinitions,
			nextName,
			currentName,
		);
		let nextConfig = renameCalendarProperty(config, currentName, property);
		nextConfig = updateCalendarProperty(nextConfig, property, definition);

		const eventChanges = property === currentName
			? []
			: await this.prepareEventChanges(config, currentName, property);
		const calendarChange = await this.prepareCalendarChange(nextConfig);
		await this.applyChanges([...eventChanges, calendarChange]);
		return nextConfig;
	}

	private async prepareEventChanges(
		config: CalendarConfig,
		currentName: string,
		nextName: string,
	): Promise<FileChange<TFile>[]> {
		const changes: FileChange<TFile>[] = [];
		const files = this.port
			.getMarkdownFiles()
			.filter(
				(file) =>
					isPathInCalendarSource(file.path, config, this.port.configDirectory) &&
					!isCalendarDocumentPath(file.path),
			)
			.sort((left, right) => left.path.localeCompare(right.path));

		for (const file of files) {
			const originalContent = await this.port.read(file);
			const decoded = this.codec.decode(originalContent);
			if (!hasOwn(decoded.frontmatter, currentName)) continue;
			if (hasOwn(decoded.frontmatter, nextName)) {
				throw new Error(
					`Cannot rename ${currentName} to ${nextName}: ${file.path} already contains ${nextName}.`,
				);
			}
			decoded.frontmatter[nextName] = decoded.frontmatter[currentName];
			delete decoded.frontmatter[currentName];
			changes.push({
				file,
				originalContent,
				nextContent: this.codec.encode(
					originalContent,
					decoded.frontmatter,
					decoded.body,
				),
			});
		}
		return changes;
	}

	private async prepareCalendarChange(
		config: CalendarConfig,
	): Promise<FileChange<TFile>> {
		const file = this.port.getFileByPath(config.documentPath);
		if (!file) throw new MissingFileError(config.documentPath);
		const originalContent = await this.port.read(file);
		const decoded = this.codec.decode(originalContent);
		applyCalendarConfigToFrontmatter(decoded.frontmatter, config);
		return {
			file,
			originalContent,
			nextContent: this.codec.encode(
				originalContent,
				decoded.frontmatter,
				decoded.body,
			),
		};
	}

	private async applyChanges(changes: FileChange<TFile>[]): Promise<void> {
		const completed: FileChange<TFile>[] = [];
		try {
			for (const change of changes) {
				change.writtenContent = await this.port.process(
					change.file,
					(currentContent) => {
						if (currentContent !== change.originalContent) {
							throw new ExternalModificationError(change.file.path);
						}
						return change.nextContent;
					},
				);
				completed.push(change);
			}
		} catch (error) {
			const rollbackFailures = await this.rollback(completed);
			if (rollbackFailures.length > 0) {
				const cause = error instanceof Error ? error.message : 'Property migration failed.';
				throw new Error(
					`${cause} Automatic rollback could not restore: ${rollbackFailures.join(', ')}.`,
				);
			}
			throw error;
		}
	}

	private async rollback(changes: FileChange<TFile>[]): Promise<string[]> {
		const failures: string[] = [];
		for (const change of [...changes].reverse()) {
			try {
				await this.port.process(change.file, (currentContent) => {
					if (currentContent !== change.writtenContent) {
						throw new ExternalModificationError(change.file.path);
					}
					return change.originalContent;
				});
			} catch {
				failures.push(change.file.path);
			}
		}
		return failures;
	}
}
