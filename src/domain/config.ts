import type {
	CalendarConfig,
	CalendarConfigResult,
	CalendarColor,
	CalendarPropertyDefinition,
	CalendarPropertyType,
	ConfigIssue,
	OpenBehavior,
} from '../types';
import { isCalendarColor } from './calendar-colors';
import { copyCalendarPropertyDefinitions } from './calendar-copy';
import { isReservedEventProperty } from './reserved-properties';
import {
	applySavedViewCatalogToFrontmatter,
	createDefaultSavedViewCatalog,
	firstCalendarSavedView,
	parseSavedViewCatalog,
	SAVED_VIEW_KEYS,
	serializeSavedViewCatalog,
} from './saved-views';

export const CALENDAR_KEYS = {
	marker: 'calendar-view',
	recursive: 'calendar-recursive',
	startDateProperty: 'calendar-start-property',
	endDateProperty: 'calendar-end-property',
	visibleProperties: 'calendar-visible-properties',
	propertyDefinitions: 'calendar-properties',
	cardColorProperty: 'calendar-card-color-property',
	viewsVersion: SAVED_VIEW_KEYS.version,
	views: SAVED_VIEW_KEYS.views,
	weekStartsOn: SAVED_VIEW_KEYS.legacyWeekStartsOn,
	layout: SAVED_VIEW_KEYS.legacyLayout,
	boardGroupProperty: SAVED_VIEW_KEYS.legacyBoardGroupProperty,
	openBehavior: 'calendar-open-behavior',
	excludePaths: 'calendar-exclude-paths',
} as const;

export const CALENDAR_DOCUMENT_FILENAME = '_calendar.md';

export const DEFAULT_VISIBLE_PROPERTIES = ['status', 'type'];

const DEFAULT_PROPERTY_DEFINITIONS: Record<string, CalendarPropertyDefinition> = {
	status: {
		type: 'select',
		options: ['None', 'Not started', 'Blocked', 'In progress', 'Abandoned', 'Done'],
		colors: {
			None: 'default',
			'Not started': 'gray',
			Blocked: 'red',
			'In progress': 'blue',
			Abandoned: 'yellow',
			Done: 'green',
		},
		default: 'Not started',
	},
	type: {
		type: 'select',
		options: ['None', 'Task', 'Learn', 'Idea'],
		colors: { None: 'default', Task: 'blue', Learn: 'green', Idea: 'purple' },
		default: 'Task',
	},
};

export function defaultCalendarPropertyDefinitions(): Record<
	string,
	CalendarPropertyDefinition
> {
	return copyCalendarPropertyDefinitions(DEFAULT_PROPERTY_DEFINITIONS);
}

export function isCalendarFrontmatter(
	frontmatter: Record<string, unknown> | undefined,
): frontmatter is Record<string, unknown> {
	return frontmatter?.[CALENDAR_KEYS.marker] === true;
}

export function isCalendarDocumentPath(path: string): boolean {
	const parts = normalizeVaultPath(path).split('/');
	return parts.length >= 2 && parts.at(-1) === CALENDAR_DOCUMENT_FILENAME;
}

function calendarFolderFromDocumentPath(path: string): string {
	return normalizeVaultPath(path).split('/').slice(0, -1).join('/');
}

export function normalizeVaultPath(path: string): string {
	return path
		.replaceAll('\\', '/')
		.split('/')
		.filter((part) => part.length > 0 && part !== '.')
		.join('/');
}

function validateVaultPath(path: string, field: string, issues: ConfigIssue[]): void {
	const slashPath = path.replaceAll('\\', '/');
	if (
		slashPath.startsWith('/') ||
		/^[A-Za-z]:\//u.test(slashPath) ||
		slashPath.split('/').includes('..')
	) {
		issues.push({
			field,
			message: 'Must be a vault-relative path without parent-directory segments.',
		});
	}
}

function stringValue(
	frontmatter: Record<string, unknown>,
	key: string,
	fallback: string,
	issues: ConfigIssue[],
	allowEmpty = false,
): string {
	const value = frontmatter[key];
	if (value === undefined || value === null) return fallback;
	if (typeof value !== 'string') {
		issues.push({ field: key, message: 'Must be a text value.' });
		return fallback;
	}
	const trimmed = value.trim();
	if (!allowEmpty && trimmed.length === 0) {
		issues.push({ field: key, message: 'Cannot be empty.' });
		return fallback;
	}
	return trimmed;
}

function booleanValue(
	frontmatter: Record<string, unknown>,
	key: string,
	fallback: boolean,
	issues: ConfigIssue[],
): boolean {
	const value = frontmatter[key];
	if (value === undefined || value === null) return fallback;
	if (typeof value !== 'boolean') {
		issues.push({ field: key, message: 'Must be true or false.' });
		return fallback;
	}
	return value;
}

function enumValue<T extends string>(
	frontmatter: Record<string, unknown>,
	key: string,
	fallback: T,
	values: readonly T[],
	issues: ConfigIssue[],
): T {
	const value = frontmatter[key];
	if (value === undefined || value === null) return fallback;
	if (typeof value !== 'string' || !values.includes(value as T)) {
		issues.push({
			field: key,
			message: `Must be one of: ${values.join(', ')}.`,
		});
		return fallback;
	}
	return value as T;
}

function stringArrayValue(
	frontmatter: Record<string, unknown>,
	key: string,
	fallback: string[],
	issues: ConfigIssue[],
): string[] {
	const value = frontmatter[key];
	if (value === undefined || value === null) return [...fallback];
	if (!Array.isArray(value)) {
		issues.push({ field: key, message: 'Must be a list of text values.' });
		return [...fallback];
	}
	const result: string[] = [];
	for (const item of value as unknown[]) {
		if (typeof item !== 'string') {
			issues.push({ field: key, message: 'Must be a list of text values.' });
			return [...fallback];
		}
		const trimmed = item.trim();
		if (trimmed) result.push(trimmed);
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCalendarPropertyType(value: unknown): value is CalendarPropertyType {
	return (
		value === 'text' ||
		value === 'select' ||
		value === 'checkbox' ||
		value === 'number'
	);
}

function selectColorsValue(
	value: unknown,
	options: string[],
	field: string,
	issues: ConfigIssue[],
): Record<string, CalendarColor> {
	const colors: Record<string, CalendarColor> = Object.fromEntries(
		options.map((option) => [option, 'default' as const]),
	);
	if (value === undefined || value === null) return colors;
	if (!isRecord(value)) {
		issues.push({ field, message: 'Select colors must be a map from option to color.' });
		return colors;
	}
	for (const [option, color] of Object.entries(value)) {
		if (!options.includes(option)) {
			issues.push({ field: `${field}.${option}`, message: 'Must name a configured option.' });
			continue;
		}
		if (!isCalendarColor(color)) {
			issues.push({
				field: `${field}.${option}`,
				message: 'Must be one of: default, gray, brown, orange, yellow, green, blue, purple, pink, red.',
			});
			continue;
		}
		colors[option] = color;
	}
	return colors;
}

function withPropertyDefault(
	definition: CalendarPropertyDefinition,
	value: unknown,
	field: string,
	issues: ConfigIssue[],
): CalendarPropertyDefinition {
	if (value === undefined) return definition;

	let message: string | undefined;
	switch (definition.type) {
		case 'text':
			if (typeof value !== 'string') message = 'Text defaults must be text values.';
			break;
		case 'number':
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				message = 'Number defaults must be finite numbers.';
			}
			break;
		case 'checkbox':
			if (typeof value !== 'boolean') message = 'Checkbox defaults must be true or false.';
			break;
		case 'select':
			if (typeof value !== 'string' || !definition.options?.includes(value)) {
				message = 'Select defaults must match one of the configured options.';
			}
			break;
	}
	if (message) {
		issues.push({ field, message });
		return definition;
	}
	return { ...definition, default: value as string | number | boolean };
}

function propertyDefinitionsValue(
	frontmatter: Record<string, unknown>,
	key: string,
	issues: ConfigIssue[],
): Record<string, CalendarPropertyDefinition> {
	const value = frontmatter[key];
	if (value === undefined || value === null) {
		return defaultCalendarPropertyDefinitions();
	}
	if (!isRecord(value)) {
		issues.push({ field: key, message: 'Must be a map of property definitions.' });
		return defaultCalendarPropertyDefinitions();
	}

	const result: Record<string, CalendarPropertyDefinition> = {};
	for (const [rawProperty, rawDefinition] of Object.entries(value)) {
		const property = rawProperty.trim();
		const field = `${key}.${rawProperty}`;
		if (!property) {
			issues.push({ field, message: 'Property name cannot be empty.' });
			continue;
		}
		if (isReservedEventProperty(property)) continue;
		if (property in result) {
			issues.push({ field, message: 'Property name must be unique.' });
			continue;
		}
		if (!isRecord(rawDefinition)) {
			issues.push({ field, message: 'Must be a property definition.' });
			continue;
		}
		if (!isCalendarPropertyType(rawDefinition.type)) {
			issues.push({
				field: `${field}.type`,
				message: 'Must be one of: text, select, checkbox, number.',
			});
			continue;
		}

		let definition: CalendarPropertyDefinition;
		if (rawDefinition.type === 'select') {
			if (!Array.isArray(rawDefinition.options)) {
				issues.push({
					field: `${field}.options`,
					message: 'Select properties must provide a list of text options.',
				});
				continue;
			}
			const rawOptions: unknown[] = rawDefinition.options;
			if (rawOptions.some((option) => typeof option !== 'string')) {
				issues.push({
					field: `${field}.options`,
					message: 'Must be a list of text values.',
				});
				continue;
			}
			const options = rawOptions
				.filter((option): option is string => typeof option === 'string')
				.map((option) => option.trim())
				.filter(Boolean);
			definition = {
				type: 'select',
				options: ['None', ...options.filter((option) => option !== 'None')],
			};
			definition.colors = selectColorsValue(
				rawDefinition.colors,
				definition.options ?? [],
				`${field}.colors`,
				issues,
			);
		} else {
			definition = { type: rawDefinition.type };
		}
		result[property] = withPropertyDefault(
			definition,
			rawDefinition.default,
			`${field}.default`,
			issues,
		);
	}
	return result;
}

export function parseCalendarConfig(
	documentPath: string,
	frontmatter: Record<string, unknown> | undefined,
): CalendarConfigResult {
	const normalizedDocumentPath = normalizeVaultPath(documentPath);
	if (!isCalendarDocumentPath(normalizedDocumentPath)) {
		return {
			isCalendarDocument: false,
			issues: [
				{
					field: 'calendar document',
					message: 'Calendar documents must use <root>/<calendar>/_calendar.md.',
				},
			],
		};
	}
	if (!isCalendarFrontmatter(frontmatter)) {
		return {
			isCalendarDocument: false,
			issues: [
				{
					field: CALENDAR_KEYS.marker,
					message: 'Set calendar-view to true to identify this document as a calendar.',
				},
			],
		};
	}

	const issues: ConfigIssue[] = [];
	const calendarFolder = calendarFolderFromDocumentPath(normalizedDocumentPath);
	const rawStartProperty = stringValue(
		frontmatter,
		CALENDAR_KEYS.startDateProperty,
		'date',
		issues,
	);
	const rawEndProperty = stringValue(
		frontmatter,
		CALENDAR_KEYS.endDateProperty,
		'date-end',
		issues,
		true,
	);
	if (isReservedEventProperty(rawStartProperty)) {
		issues.push({
			field: CALENDAR_KEYS.startDateProperty,
			message: 'Must not use a reserved event property.',
		});
	}
	if (rawEndProperty && isReservedEventProperty(rawEndProperty)) {
		issues.push({
			field: CALENDAR_KEYS.endDateProperty,
			message: 'Must not use a reserved event property.',
		});
	}
	const rawTitle = frontmatter.title;
	const folderName = calendarFolder.split('/').at(-1) ?? '_calendar';
	const name =
		typeof rawTitle === 'string' && rawTitle.trim().length > 0
			? rawTitle.trim()
			: folderName;
	const visibleProperties = stringArrayValue(
		frontmatter,
		CALENDAR_KEYS.visibleProperties,
		DEFAULT_VISIBLE_PROPERTIES,
		issues,
	).filter((property) => !isReservedEventProperty(property));
	const propertyDefinitions = propertyDefinitionsValue(
		frontmatter,
		CALENDAR_KEYS.propertyDefinitions,
		issues,
	);
	const defaultCardColorProperty =
		propertyDefinitions.status?.type === 'select' ? 'status' : '';
	const rawCardColorProperty = stringValue(
		frontmatter,
		CALENDAR_KEYS.cardColorProperty,
		defaultCardColorProperty,
		issues,
		true,
	);
	let cardColorProperty: string | undefined;
	if (rawCardColorProperty) {
		if (propertyDefinitions[rawCardColorProperty]?.type !== 'select') {
			issues.push({
				field: CALENDAR_KEYS.cardColorProperty,
				message: 'Must name a configured select property.',
			});
		} else {
			cardColorProperty = rawCardColorProperty;
		}
	}
	const excludePaths = stringArrayValue(
		frontmatter,
		CALENDAR_KEYS.excludePaths,
		[],
		issues,
	);
	for (const path of excludePaths) {
		validateVaultPath(path, CALENDAR_KEYS.excludePaths, issues);
	}
	const savedViews = parseSavedViewCatalog(frontmatter, {
		startDateProperty: rawStartProperty,
		endDateProperty: rawEndProperty || undefined,
		propertyDefinitions,
	});
	const compatibilityCalendarView = firstCalendarSavedView(savedViews.catalog);

	const config: CalendarConfig = {
		documentPath: normalizedDocumentPath,
		name,
		sourceFolder: calendarFolder,
		recursive: booleanValue(
			frontmatter,
			CALENDAR_KEYS.recursive,
			true,
			issues,
		),
		startDateProperty: rawStartProperty,
		visibleProperties,
		propertyDefinitions,
		cardColorProperty,
		viewCatalog: savedViews.catalog,
		// Transitional facade for callers that have not selected a saved view yet.
		weekStartsOn: compatibilityCalendarView?.weekStartsOn ?? 'locale',
		layout: compatibilityCalendarView?.layout ?? 'month',
		openBehavior: enumValue<OpenBehavior>(
			frontmatter,
			CALENDAR_KEYS.openBehavior,
			'same-leaf',
			['same-leaf', 'new-tab'],
			issues,
		),
		createFolder: calendarFolder,
		excludePaths: excludePaths.map(normalizeVaultPath),
	};
	if (rawEndProperty.length > 0) config.endDateProperty = rawEndProperty;

	return {
		isCalendarDocument: true,
		config: issues.length === 0 ? config : undefined,
		issues: [...issues, ...savedViews.issues],
	};
}

export function applyCalendarConfigToFrontmatter(
	frontmatter: Record<string, unknown>,
	config: CalendarConfig,
): void {
	frontmatter[CALENDAR_KEYS.marker] = true;
	frontmatter.title = config.name;
	frontmatter[CALENDAR_KEYS.recursive] = config.recursive;
	delete frontmatter['calendar-title-property'];
	frontmatter[CALENDAR_KEYS.startDateProperty] = config.startDateProperty;
	if (config.endDateProperty) {
		frontmatter[CALENDAR_KEYS.endDateProperty] = config.endDateProperty;
	} else {
		frontmatter[CALENDAR_KEYS.endDateProperty] = '';
	}
	frontmatter[CALENDAR_KEYS.visibleProperties] = config.visibleProperties.filter(
		(property) => !isReservedEventProperty(property),
	);
	frontmatter[CALENDAR_KEYS.propertyDefinitions] = copyCalendarPropertyDefinitions(
		Object.fromEntries(
			Object.entries(config.propertyDefinitions).filter(
				([property]) => !isReservedEventProperty(property),
			),
		),
	);
	frontmatter[CALENDAR_KEYS.cardColorProperty] =
		config.cardColorProperty && !isReservedEventProperty(config.cardColorProperty)
			? config.cardColorProperty
			: '';
	frontmatter[CALENDAR_KEYS.openBehavior] = config.openBehavior;
	if (config.excludePaths.length > 0) {
		frontmatter[CALENDAR_KEYS.excludePaths] = [...config.excludePaths];
	} else {
		delete frontmatter[CALENDAR_KEYS.excludePaths];
	}
}

/**
 * Writes a complete canonical calendar document. Ordinary settings saves should use
 * applyCalendarConfigToFrontmatter so a stale config cannot replace newer saved views.
 */
export function applyCalendarConfigWithSavedViewsToFrontmatter(
	frontmatter: Record<string, unknown>,
	config: CalendarConfig,
): void {
	const catalog =
		config.viewCatalog ??
		createDefaultSavedViewCatalog(config.layout, config.weekStartsOn);
	// Validate before changing shared keys so direct callers never observe a partial write.
	serializeSavedViewCatalog(catalog);
	applyCalendarConfigToFrontmatter(frontmatter, config);
	const written = applySavedViewCatalogToFrontmatter(frontmatter, catalog);
	if (!written) {
		throw new Error('Cannot write a structurally invalid saved-view catalog.');
	}
}
