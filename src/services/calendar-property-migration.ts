import {
	applyCalendarConfigWithSavedViewsToFrontmatter,
	isCalendarDocumentPath,
	parseCalendarConfig,
} from '../domain/config';
import {
	renameCalendarProperty,
	sameCalendarPropertyDefinition,
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
import { CalendarConfigMutationCoordinator } from './calendar-config-mutation-coordinator';

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

interface CurrentCalendar<TFile extends CalendarPropertyMigrationFile> {
	file: TFile;
	originalContent: string;
	frontmatter: Record<string, unknown>;
	body: string;
	config: CalendarConfig;
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
		private readonly configCoordinator: CalendarConfigMutationCoordinator,
	) {}

	async rename(
		config: CalendarConfig,
		currentName: string,
		nextName: string,
		definition: CalendarPropertyDefinition,
	): Promise<CalendarConfig> {
		return this.configCoordinator.run(config.documentPath, async () => {
			const currentCalendar = await this.readCurrentCalendar(config.documentPath);
			return this.renameCurrent(
				currentCalendar,
				currentName,
				nextName,
				definition,
				config.propertyDefinitions[currentName],
			);
		});
	}

	private async renameCurrent(
		currentCalendar: CurrentCalendar<TFile>,
		currentName: string,
		nextName: string,
		definition: CalendarPropertyDefinition,
		expectedDefinition: CalendarPropertyDefinition | undefined,
	): Promise<CalendarConfig> {
		const config = currentCalendar.config;
		if (
			!sameCalendarPropertyDefinition(
				expectedDefinition,
				config.propertyDefinitions[currentName],
			)
		) {
			throw new ExternalModificationError(config.documentPath);
		}
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
		const calendarChange = this.prepareCalendarChange(
			currentCalendar,
			nextConfig,
		);
		await this.applyChanges([...eventChanges, calendarChange]);
		return nextConfig;
	}

	private async readCurrentCalendar(
		documentPath: string,
	): Promise<CurrentCalendar<TFile>> {
		const file = this.port.getFileByPath(documentPath);
		if (!file) throw new MissingFileError(documentPath);
		const originalContent = await this.port.read(file);
		const decoded = this.codec.decode(originalContent);
		const parsed = parseCalendarConfig(documentPath, decoded.frontmatter);
		if (!parsed.config) {
			const details = parsed.issues
				.map((issue) => `${issue.field}: ${issue.message}`)
				.join('; ');
			throw new Error(
				`Cannot migrate properties in an invalid calendar document${details ? `: ${details}` : '.'}`,
			);
		}
		if (!parsed.config.viewCatalog?.canMutate) {
			throw new Error(
				'Cannot migrate properties while the saved-view catalog is structurally invalid.',
			);
		}
		return {
			file,
			originalContent,
			frontmatter: decoded.frontmatter,
			body: decoded.body,
			config: parsed.config,
		};
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

	private prepareCalendarChange(
		current: CurrentCalendar<TFile>,
		config: CalendarConfig,
	): FileChange<TFile> {
		applyCalendarConfigWithSavedViewsToFrontmatter(current.frontmatter, config);
		return {
			file: current.file,
			originalContent: current.originalContent,
			nextContent: this.codec.encode(
				current.originalContent,
				current.frontmatter,
				current.body,
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
