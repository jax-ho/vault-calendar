import {
	App,
	normalizePath,
	stringifyYaml,
	TFile,
	TFolder,
} from 'obsidian';
import {
	applyCalendarConfigToFrontmatter,
	applyCalendarConfigWithSavedViewsToFrontmatter,
	defaultCalendarPropertyDefinitions,
	isCalendarDocumentPath,
	normalizeVaultPath,
	parseCalendarConfig,
} from '../domain/config';
import { copyCalendarConfig } from '../domain/calendar-copy';
import {
	applyCalendarPropertyMutation,
	copyCalendarPropertyMutation,
} from '../domain/calendar-property-mutation';
import type { CalendarPropertyMutation } from '../domain/calendar-property-mutation';
import { parseCalendarDate, type PlainDate } from '../domain/dates';
import { clearInvalidBoardGroupReferences } from '../domain/property-schema';
import {
	applySavedViewCatalogToFrontmatter,
	createDefaultSavedViewCatalog,
	isWritableBoardGroupProperty,
	parseSavedViewCatalog,
} from '../domain/saved-views';
import {
	uniqueEventMarkdownPath,
	uniqueMarkdownPath,
} from '../domain/note-creation';
import { createEventPropertyDraft } from '../domain/event-creation';
import { normalizeParentItemLink } from '../domain/item-relations';
import {
	EVENT_PARENT_ITEM_PROPERTY,
	EVENT_TITLE_PROPERTY,
	RESERVED_EVENT_PROPERTIES,
	isReservedEventProperty,
} from '../domain/reserved-properties';
import { isPathInCalendarSource } from '../domain/source-scope';
import type {
	CalendarConfig,
	CalendarConfigResult,
	ConfigIssue,
} from '../types';
import { isCalendarDocument } from './calendar-index';
import { CalendarConfigMutationCoordinator } from './calendar-config-mutation-coordinator';
import { ObsidianMarkdownDocumentCodec } from './obsidian-markdown-document';

export interface CreateCalendarInput {
	name: string;
	documentFolder: string;
	startDateProperty: string;
	endDateProperty?: string;
}

export type { CalendarPropertyMutation } from '../domain/calendar-property-mutation';

export type CalendarSharedConfigField =
	| 'name'
	| 'recursive'
	| 'startDateProperty'
	| 'endDateProperty'
	| 'openBehavior'
	| 'excludePaths';

export interface SaveCalendarOptions {
	changedFields?: readonly CalendarSharedConfigField[];
	propertyMutations?: readonly CalendarPropertyMutation[];
	revalidateBoardGroups?: readonly string[];
}

function applySharedField(
	target: CalendarConfig,
	source: CalendarConfig,
	field: CalendarSharedConfigField,
): void {
	switch (field) {
		case 'name':
			target.name = source.name;
			return;
		case 'recursive':
			target.recursive = source.recursive;
			return;
		case 'startDateProperty':
			target.startDateProperty = source.startDateProperty;
			return;
		case 'endDateProperty':
			if (source.endDateProperty) target.endDateProperty = source.endDateProperty;
			else delete target.endDateProperty;
			return;
		case 'openBehavior':
			target.openBehavior = source.openBehavior;
			return;
		case 'excludePaths':
			target.excludePaths = [...source.excludePaths];
	}
}

function mergeChangedSharedFields(
	current: CalendarConfig,
	requested: CalendarConfig,
	fields: readonly CalendarSharedConfigField[] | undefined,
): CalendarConfig {
	if (!fields) return copyCalendarConfig(requested);
	const merged = copyCalendarConfig(current);
	for (const field of new Set(fields)) applySharedField(merged, requested, field);
	return merged;
}

function markdownDocument(
	frontmatter: Record<string, unknown>,
	body = '',
): string {
	return `---\n${stringifyYaml(frontmatter)}---\n\n${body}`;
}

function validateDatePropertyNames(
	startDateProperty: string,
	endDateProperty?: string,
): void {
	if (isReservedEventProperty(startDateProperty)) {
		throw new Error('Start date property cannot use a reserved event property.');
	}
	if (endDateProperty && isReservedEventProperty(endDateProperty)) {
		throw new Error('End date property cannot use a reserved event property.');
	}
}

export class CalendarDocumentService {
	private readonly documentCodec = new ObsidianMarkdownDocumentCodec();

	constructor(
		private readonly app: App,
		private readonly createEventId: (() => string) | undefined,
		private readonly configCoordinator: CalendarConfigMutationCoordinator,
	) {}

	list(): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) =>
				isCalendarDocument(file.path, this.app.metadataCache.getFileCache(file)),
			)
			.sort((left, right) => left.path.localeCompare(right.path));
	}

	read(file: TFile): CalendarConfigResult {
		const cache = this.app.metadataCache.getFileCache(file);
		return parseCalendarConfig(file.path, cache?.frontmatter);
	}

	async readFresh(file: TFile): Promise<CalendarConfigResult> {
		const content = await this.app.vault.read(file);
		const document = this.documentCodec.decode(content);
		return parseCalendarConfig(file.path, document.frontmatter);
	}

	validateLocations(config: CalendarConfig): ConfigIssue[] {
		const issues: ConfigIssue[] = [];
		if (config.sourceFolder.length > 0) {
			const source = this.app.vault.getFolderByPath(config.sourceFolder);
			if (!source) {
				issues.push({
					field: 'calendar folder',
					message: `Folder not found: ${config.sourceFolder}`,
				});
			}
		}
		return issues;
	}

	async create(input: CreateCalendarInput): Promise<TFile> {
		const name = input.name.trim();
		if (!name) throw new Error('Enter a calendar name.');
		if (!input.startDateProperty.trim()) throw new Error('Enter a start date property.');
		validateDatePropertyNames(
			input.startDateProperty.trim(),
			input.endDateProperty?.trim(),
		);
		const folder = normalizeVaultPath(input.documentFolder);
		if (!folder) throw new Error('Calendars require a dedicated folder.');
		await this.ensureFolder(folder);
		const path = normalizePath(
			uniqueMarkdownPath('_calendar', folder, (candidate) =>
				Boolean(this.app.vault.getAbstractFileByPath(candidate)),
			),
		);

		const frontmatter: Record<string, unknown> = {};
		const calendarFolder = normalizeVaultPath(input.documentFolder);
		const propertyDefinitions = defaultCalendarPropertyDefinitions();
		const viewCatalog = createDefaultSavedViewCatalog();
		const config: CalendarConfig = {
			documentPath: path,
			name,
			sourceFolder: calendarFolder,
			recursive: true,
			startDateProperty: input.startDateProperty.trim(),
			visibleProperties: Object.keys(propertyDefinitions),
			propertyDefinitions,
			cardColorProperty: 'status',
			viewCatalog,
			weekStartsOn: 'locale',
			layout: 'month',
			openBehavior: 'same-leaf',
			createFolder: calendarFolder,
			excludePaths: [],
		};
		const endProperty = input.endDateProperty?.trim();
		if (endProperty) config.endDateProperty = endProperty;
		applyCalendarConfigWithSavedViewsToFrontmatter(frontmatter, config);
		return this.app.vault.create(path, markdownDocument(frontmatter));
	}

	async save(
		config: CalendarConfig,
		options: SaveCalendarOptions = {},
	): Promise<CalendarConfig> {
		const requested = copyCalendarConfig(config);
		const propertyMutations = (options.propertyMutations ?? []).map(
			copyCalendarPropertyMutation,
		);
		const revalidateBoardGroups = [...(options.revalidateBoardGroups ?? [])];
		const usesPatch =
			options.changedFields !== undefined ||
			options.propertyMutations !== undefined ||
			options.revalidateBoardGroups !== undefined;
		const changedFields = usesPatch ? [...(options.changedFields ?? [])] : undefined;
		if (!isCalendarDocumentPath(requested.documentPath)) {
			throw new Error('Calendar documents must use <root>/<calendar>/_calendar.md.');
		}
		validateDatePropertyNames(
			requested.startDateProperty,
			requested.endDateProperty,
		);
		return this.configCoordinator.run(requested.documentPath, async () => {
			const file = this.app.vault.getFileByPath(requested.documentPath);
			if (!file) throw new Error(`Calendar document not found: ${requested.documentPath}`);
			let committed: CalendarConfig | undefined;
			await this.app.fileManager.processFrontMatter(file, (rawFrontmatter) => {
				const frontmatter = rawFrontmatter as Record<string, unknown>;
				const currentResult = parseCalendarConfig(requested.documentPath, frontmatter);
				const currentConfig = currentResult.config ?? requested;
				const dateCleanupCandidates = revalidateBoardGroups.filter(
					(property) =>
						Boolean(property) &&
						isWritableBoardGroupProperty(currentConfig, property),
				);
				let nextConfig = mergeChangedSharedFields(
					currentConfig,
					requested,
					changedFields,
				);
				if (
					(changedFields || propertyMutations.length > 0) &&
					!currentResult.config
				) {
					throw new Error(
						'The calendar configuration changed and must be repaired before saving settings.',
					);
				}
				const affectedBoardGroups = new Set<string>();
				for (const mutation of propertyMutations) {
					const beforeMutation = nextConfig;
					nextConfig = applyCalendarPropertyMutation(beforeMutation, mutation);
					if (
						mutation.kind === 'remove' &&
						beforeMutation.propertyDefinitions[mutation.property]
					) {
						affectedBoardGroups.add(mutation.property);
					}
					if (
						mutation.kind === 'update' &&
						isWritableBoardGroupProperty(beforeMutation, mutation.property) &&
						!isWritableBoardGroupProperty(nextConfig, mutation.property)
					) {
						affectedBoardGroups.add(mutation.property);
					}
				}
				for (const property of dateCleanupCandidates) {
					if (!isWritableBoardGroupProperty(nextConfig, property)) {
						affectedBoardGroups.add(property);
					}
				}
				validateDatePropertyNames(
					nextConfig.startDateProperty,
					nextConfig.endDateProperty,
				);
				const currentViews = parseSavedViewCatalog(frontmatter, {
					startDateProperty: nextConfig.startDateProperty,
					endDateProperty: nextConfig.endDateProperty,
					propertyDefinitions: nextConfig.propertyDefinitions,
				});
				if (
					affectedBoardGroups.size > 0 &&
					!currentViews.catalog.canMutate
				) {
					throw new Error(
						'Cannot clear Board grouping in a structurally invalid saved-view catalog.',
					);
				}

				let catalogToWrite =
					currentViews.catalog.source === 'legacy'
						? currentViews.catalog
						: undefined;
				if (affectedBoardGroups.size > 0) {
					const configWithCurrentViews = {
						...nextConfig,
						viewCatalog: currentViews.catalog,
					};
					const reconciled = clearInvalidBoardGroupReferences(
						configWithCurrentViews,
						affectedBoardGroups,
					);
					if (reconciled !== configWithCurrentViews) {
						catalogToWrite = reconciled.viewCatalog;
					}
				}

				applyCalendarConfigToFrontmatter(frontmatter, nextConfig);
				if (
					catalogToWrite &&
					!applySavedViewCatalogToFrontmatter(frontmatter, catalogToWrite)
				) {
					throw new Error('Unable to update the saved-view configuration.');
				}
				const verified = parseCalendarConfig(requested.documentPath, frontmatter);
				if (!verified.config) {
					throw new Error('The updated calendar configuration could not be verified.');
				}
				committed = copyCalendarConfig(verified.config);
			});
			if (!committed) throw new Error('The calendar settings update did not complete.');
			return committed;
		});
	}

	async createEvent(
		config: CalendarConfig,
		title: string,
		date: PlainDate,
		properties?: Record<string, unknown>,
		body = '',
	): Promise<TFile> {
		validateDatePropertyNames(
			config.startDateProperty,
			config.endDateProperty,
		);
		const folder = normalizeVaultPath(config.createFolder);
		await this.ensureFolder(folder);
		const path = normalizePath(
			uniqueEventMarkdownPath(
				title,
				folder,
				(candidate) => Boolean(this.app.vault.getAbstractFileByPath(candidate)),
				this.createEventId,
			),
		);
		const frontmatter: Record<string, unknown> = {
			[EVENT_TITLE_PROPERTY]: title.trim(),
			[config.startDateProperty]: date,
		};
		const parentItem = normalizeParentItemLink(
			properties?.[EVENT_PARENT_ITEM_PROPERTY],
		);
		if (parentItem) {
			frontmatter[EVENT_PARENT_ITEM_PROPERTY] = parentItem;
		}
		const reservedProperties = new Set([
			...RESERVED_EVENT_PROPERTIES,
			config.startDateProperty,
			config.endDateProperty,
		]);
		const defaultProperties = createEventPropertyDraft(config);
		for (const property of Object.keys(config.propertyDefinitions)) {
			if (reservedProperties.has(property)) continue;
			const value =
				properties && Object.prototype.hasOwnProperty.call(properties, property)
					? properties[property]
					: defaultProperties[property];
			if (
				value === undefined ||
				value === null ||
				value === '' ||
				(Array.isArray(value) && value.length === 0)
			) {
				continue;
			}
			frontmatter[property] = value;
		}
		return this.app.vault.create(path, markdownDocument(frontmatter, body));
	}

	discoverDateProperties(config: CalendarConfig): string[] {
		const properties = new Set<string>([config.startDateProperty]);
		if (config.endDateProperty) properties.add(config.endDateProperty);
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!isPathInCalendarSource(file.path, config, this.app.vault.configDir)) continue;
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache?.frontmatter || isCalendarDocument(file.path, cache)) continue;
			for (const [key, value] of Object.entries(cache.frontmatter)) {
				if (key !== 'position' && parseCalendarDate(value)) properties.add(key);
			}
		}
		return [...properties].sort((left, right) => left.localeCompare(right));
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		if (!folderPath) return;
		let current = '';
		for (const segment of folderPath.split('/')) {
			current = current ? `${current}/${segment}` : segment;
			const existing = this.app.vault.getAbstractFileByPath(current);
			if (existing instanceof TFile) throw new Error(`${current} is a file, not a folder.`);
			if (!(existing instanceof TFolder)) await this.app.vault.createFolder(current);
		}
	}
}
