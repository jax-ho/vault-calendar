import {
	App,
	normalizePath,
	stringifyYaml,
	TFile,
	TFolder,
} from 'obsidian';
import {
	applyCalendarConfigToFrontmatter,
	defaultCalendarPropertyDefinitions,
	isCalendarDocumentPath,
	normalizeVaultPath,
	parseCalendarConfig,
} from '../domain/config';
import { parseCalendarDate, type PlainDate } from '../domain/dates';
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

export interface CreateCalendarInput {
	name: string;
	documentFolder: string;
	startDateProperty: string;
	endDateProperty?: string;
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
	constructor(
		private readonly app: App,
		private readonly createEventId?: () => string,
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
		const config: CalendarConfig = {
			documentPath: path,
			name,
			sourceFolder: calendarFolder,
			recursive: true,
			startDateProperty: input.startDateProperty.trim(),
			visibleProperties: Object.keys(propertyDefinitions),
			propertyDefinitions,
			cardColorProperty: 'status',
			weekStartsOn: 'locale',
			layout: 'month',
			openBehavior: 'same-leaf',
			createFolder: calendarFolder,
			excludePaths: [],
		};
		const endProperty = input.endDateProperty?.trim();
		if (endProperty) config.endDateProperty = endProperty;
		applyCalendarConfigToFrontmatter(frontmatter, config);
		return this.app.vault.create(path, markdownDocument(frontmatter));
	}

	async save(config: CalendarConfig): Promise<void> {
		if (!isCalendarDocumentPath(config.documentPath)) {
			throw new Error('Calendar documents must use <root>/<calendar>/_calendar.md.');
		}
		validateDatePropertyNames(
			config.startDateProperty,
			config.endDateProperty,
		);
		const file = this.app.vault.getFileByPath(config.documentPath);
		if (!file) throw new Error(`Calendar document not found: ${config.documentPath}`);
		await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
			applyCalendarConfigToFrontmatter(frontmatter as Record<string, unknown>, config);
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
