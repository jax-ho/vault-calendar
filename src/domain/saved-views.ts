import type {
	BoardSavedView,
	CalendarConfig,
	CalendarLayout,
	CalendarPropertyDefinition,
	CalendarSavedView,
	ConfigIssue,
	SavedView,
	SavedViewCatalog,
	SavedViewCatalogEntry,
	ViewConfigIssue,
	WeekStartsOn,
} from '../types';
import { isReservedEventProperty } from './reserved-properties';

export const SAVED_VIEW_SCHEMA_VERSION = 1;

export const SAVED_VIEW_KEYS = {
	version: 'calendar-views-version',
	views: 'calendar-views',
	legacyBoardGroupProperty: 'calendar-board-group-property',
	legacyLayout: 'calendar-layout',
	legacyWeekStartsOn: 'calendar-week-starts-on',
} as const;

const CALENDAR_LAYOUTS = ['month', 'week'] as const;
const WEEK_START_VALUES = ['locale', 'monday', 'sunday'] as const;
const VIEW_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u;

export interface SavedViewValidationContext {
	startDateProperty: string;
	endDateProperty?: string;
	propertyDefinitions: Record<string, CalendarPropertyDefinition>;
}

export interface SavedViewCatalogParseResult {
	catalog: SavedViewCatalog;
	issues: ConfigIssue[];
}

interface ParsedEntry {
	entry: SavedViewCatalogEntry;
	issues: ViewConfigIssue[];
	structuralIssue: boolean;
}

function hasOwn(value: Record<string, unknown>, property: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, property);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function copyRaw<T>(value: T): T {
	return structuredClone(value);
}

function viewIssue(
	field: string,
	message: string,
	viewId?: string,
): ViewConfigIssue {
	const issue: ViewConfigIssue = { field, message };
	if (viewId !== undefined) issue.viewId = viewId;
	return issue;
}

export function isValidViewId(value: unknown): value is string {
	return typeof value === 'string' && VIEW_ID_PATTERN.test(value);
}

function hasDuplicateOptions(definition: CalendarPropertyDefinition): boolean {
	if (!definition.options) return false;
	return new Set(definition.options).size !== definition.options.length;
}

function boardGroupProblem(
	context: SavedViewValidationContext,
	property: string,
): string | undefined {
	if (property.toLocaleLowerCase() === 'position') {
		return 'Position is reserved for ordering and cannot group a Board.';
	}
	if (isReservedEventProperty(property)) {
		return 'Reserved event properties cannot group a Board.';
	}
	if (property === context.startDateProperty || property === context.endDateProperty) {
		return 'Calendar date properties cannot group a Board.';
	}
	const definition = context.propertyDefinitions[property];
	if (!definition || definition.type !== 'select' || !definition.options) {
		return 'Must name a configured Select property.';
	}
	if (hasDuplicateOptions(definition)) {
		return 'The selected property must not contain duplicate options.';
	}
	return undefined;
}

export function isWritableBoardGroupProperty(
	config: CalendarConfig,
	property: string,
): boolean {
	return (
		property.trim().length > 0 &&
		boardGroupProblem(
			{
				startDateProperty: config.startDateProperty,
				endDateProperty: config.endDateProperty,
				propertyDefinitions: config.propertyDefinitions,
			},
			property,
		) === undefined
	);
}

function entryMetadata(raw: unknown): {
	id?: string;
	name?: string;
	viewType?: string;
} {
	if (!isRecord(raw)) return {};
	const metadata: { id?: string; name?: string; viewType?: string } = {};
	if (typeof raw.id === 'string') metadata.id = raw.id;
	if (typeof raw.name === 'string' && raw.name.trim()) metadata.name = raw.name.trim();
	if (typeof raw.type === 'string') metadata.viewType = raw.type;
	return metadata;
}

function invalidEntry(
	raw: unknown,
	issues: ViewConfigIssue[],
): SavedViewCatalogEntry {
	const metadata = entryMetadata(raw);
	const entry: SavedViewCatalogEntry = {
		kind: 'invalid',
		raw: copyRaw(raw),
		issues: issues.map((issue) => ({ ...issue })),
	};
	if (metadata.id !== undefined) entry.id = metadata.id;
	if (metadata.name !== undefined) entry.name = metadata.name;
	return entry;
}

function unsupportedEntry(raw: unknown): SavedViewCatalogEntry {
	const metadata = entryMetadata(raw);
	const entry: SavedViewCatalogEntry = {
		kind: 'unsupported',
		raw: copyRaw(raw),
	};
	if (metadata.id !== undefined) entry.id = metadata.id;
	if (metadata.name !== undefined) entry.name = metadata.name;
	if (metadata.viewType !== undefined) entry.viewType = metadata.viewType;
	return entry;
}

function validEntry(
	definition: SavedView,
	warnings: ViewConfigIssue[],
): SavedViewCatalogEntry {
	const entry: SavedViewCatalogEntry = { kind: 'valid', definition };
	if (warnings.length > 0) {
		entry.warnings = warnings.map((warning) => ({ ...warning }));
	}
	return entry;
}

function duplicateIds(rawViews: unknown[]): Set<string> {
	const counts = new Map<string, number>();
	for (const raw of rawViews) {
		if (!isRecord(raw) || typeof raw.id !== 'string') continue;
		counts.set(raw.id, (counts.get(raw.id) ?? 0) + 1);
	}
	return new Set(
		[...counts.entries()]
			.filter(([, count]) => count > 1)
			.map(([id]) => id),
	);
}

function normalizedViewName(name: string): string {
	return name.trim().toLocaleLowerCase();
}

function duplicateNames(rawViews: unknown[]): Set<string> {
	const counts = new Map<string, number>();
	for (const raw of rawViews) {
		if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.trim()) continue;
		const name = normalizedViewName(raw.name);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return new Set(
		[...counts.entries()]
			.filter(([, count]) => count > 1)
			.map(([name]) => name),
	);
}

function appendEntryWarnings(
	parsed: ParsedEntry,
	warnings: ViewConfigIssue[],
): ParsedEntry {
	if (warnings.length === 0) return parsed;
	let entry = parsed.entry;
	if (entry.kind === 'valid') {
		entry = {
			...entry,
			warnings: [...(entry.warnings ?? []), ...warnings],
		};
	} else if (entry.kind === 'invalid') {
		entry = { ...entry, issues: [...entry.issues, ...warnings] };
	}
	return {
		...parsed,
		entry,
		issues: [...parsed.issues, ...warnings],
	};
}

function unknownFields(
	raw: Record<string, unknown>,
	allowed: ReadonlySet<string>,
): string[] {
	return Object.keys(raw).filter((key) => !allowed.has(key));
}

function parseCanonicalEntry(
	raw: unknown,
	index: number,
	duplicates: ReadonlySet<string>,
	duplicateViewNames: ReadonlySet<string>,
	context: SavedViewValidationContext,
): ParsedEntry {
	const prefix = `${SAVED_VIEW_KEYS.views}[${index}]`;
	if (!isRecord(raw)) {
		const issue = viewIssue(prefix, 'Must be a saved-view definition.');
		return {
			entry: invalidEntry(raw, [issue]),
			issues: [issue],
			structuralIssue: true,
		};
	}

	const structuralIssues: ViewConfigIssue[] = [];
	const rawId = raw.id;
	const issueViewId = typeof rawId === 'string' ? rawId : undefined;
	if (!isValidViewId(rawId)) {
		structuralIssues.push(
			viewIssue(
				`${prefix}.id`,
				'Must be 1-64 lowercase letters, numbers, or hyphens, without a leading or trailing hyphen.',
				issueViewId,
			),
		);
	} else if (duplicates.has(rawId)) {
		structuralIssues.push(
			viewIssue(`${prefix}.id`, 'View IDs must be unique.', rawId),
		);
	}

	const rawName = raw.name;
	if (typeof rawName !== 'string' || rawName.trim().length === 0) {
		structuralIssues.push(
			viewIssue(`${prefix}.name`, 'View name must be non-empty text.', issueViewId),
		);
	}

	const rawType = raw.type;
	if (typeof rawType !== 'string' || rawType.length === 0) {
		structuralIssues.push(
			viewIssue(`${prefix}.type`, 'View type must be non-empty text.', issueViewId),
		);
	}

	if (structuralIssues.length > 0) {
		return {
			entry: invalidEntry(raw, structuralIssues),
			issues: structuralIssues,
			structuralIssue: true,
		};
	}

	const id = rawId as string;
	const name = (rawName as string).trim();
	const nameWarnings = duplicateViewNames.has(normalizedViewName(name))
		? [viewIssue(`${prefix}.name`, 'View names should be unique.', id)]
		: [];
	if (rawType !== 'calendar' && rawType !== 'board') {
		const issue = viewIssue(
			`${prefix}.type`,
			`Unsupported saved-view type: ${String(rawType)}.`,
			id,
		);
		return {
			entry: unsupportedEntry(raw),
			issues: [issue, ...nameWarnings],
			structuralIssue: true,
		};
	}

	const allowed = new Set(
		rawType === 'calendar'
			? ['id', 'name', 'type', 'layout', 'week-starts-on']
			: ['id', 'name', 'type', 'group-by'],
	);
	const extraFields = unknownFields(raw, allowed);
	if (extraFields.length > 0) {
		const issues = extraFields.map((field) =>
			viewIssue(
				`${prefix}.${field}`,
				'Unknown fields cannot be rewritten safely by this saved-view schema version.',
				id,
			),
		);
		return {
			entry: invalidEntry(raw, [...issues, ...nameWarnings]),
			issues: [...issues, ...nameWarnings],
			structuralIssue: true,
		};
	}

	if (rawType === 'calendar') {
		return appendEntryWarnings(
			parseCalendarEntry(raw, prefix, id, name),
			nameWarnings,
		);
	}
	return appendEntryWarnings(
		parseBoardEntry(raw, prefix, id, name, context),
		nameWarnings,
	);
}

function parseCalendarEntry(
	raw: Record<string, unknown>,
	prefix: string,
	id: string,
	name: string,
	fields = {
		layout: `${prefix}.layout`,
		weekStartsOn: `${prefix}.week-starts-on`,
	},
): ParsedEntry {
	const warnings: ViewConfigIssue[] = [];
	const invalidIssues: ViewConfigIssue[] = [];
	let layout: CalendarLayout = 'month';
	let weekStartsOn: WeekStartsOn = 'locale';

	if (!hasOwn(raw, 'layout')) {
		warnings.push(
			viewIssue(fields.layout, 'Missing layout; using month.', id),
		);
	} else if (CALENDAR_LAYOUTS.includes(raw.layout as CalendarLayout)) {
		layout = raw.layout as CalendarLayout;
	} else {
		invalidIssues.push(
			viewIssue(fields.layout, 'Must be one of: month, week.', id),
		);
	}

	if (!hasOwn(raw, 'week-starts-on')) {
		warnings.push(
			viewIssue(
				fields.weekStartsOn,
				'Missing week start; using locale.',
				id,
			),
		);
	} else if (WEEK_START_VALUES.includes(raw['week-starts-on'] as WeekStartsOn)) {
		weekStartsOn = raw['week-starts-on'] as WeekStartsOn;
	} else {
		invalidIssues.push(
			viewIssue(
				fields.weekStartsOn,
				'Must be one of: locale, monday, sunday.',
				id,
			),
		);
	}

	if (invalidIssues.length > 0) {
		return {
			entry: invalidEntry(raw, invalidIssues),
			issues: invalidIssues,
			structuralIssue: false,
		};
	}

	const definition: CalendarSavedView = {
		id,
		name,
		type: 'calendar',
		layout,
		weekStartsOn,
	};
	return {
		entry: validEntry(definition, warnings),
		issues: warnings,
		structuralIssue: false,
	};
}

function parseBoardEntry(
	raw: Record<string, unknown>,
	prefix: string,
	id: string,
	name: string,
	context: SavedViewValidationContext,
	groupField = `${prefix}.group-by`,
): ParsedEntry {
	const warnings: ViewConfigIssue[] = [];
	const definition: BoardSavedView = { id, name, type: 'board' };
	const rawGroupBy = raw['group-by'];

	if (!hasOwn(raw, 'group-by') || rawGroupBy === null) {
		warnings.push(
			viewIssue(groupField, 'Choose a Select property to group this Board.', id),
		);
	} else if (typeof rawGroupBy !== 'string') {
		const issue = viewIssue(groupField, 'Must be a text value.', id);
		return {
			entry: invalidEntry(raw, [issue]),
			issues: [issue],
			structuralIssue: false,
		};
	} else {
		const groupBy = rawGroupBy.trim();
		if (!groupBy) {
			warnings.push(
				viewIssue(groupField, 'Choose a Select property to group this Board.', id),
			);
		} else {
			definition.groupBy = groupBy;
			const problem = boardGroupProblem(context, groupBy);
			if (problem) warnings.push(viewIssue(groupField, problem, id));
		}
	}

	return {
		entry: validEntry(definition, warnings),
		issues: warnings,
		structuralIssue: false,
	};
}

function parseLegacyCalendarEntry(
	frontmatter: Record<string, unknown>,
): ParsedEntry {
	const rawLayout = frontmatter[SAVED_VIEW_KEYS.legacyLayout];
	const rawWeekStartsOn = frontmatter[SAVED_VIEW_KEYS.legacyWeekStartsOn];
	const raw: Record<string, unknown> = {
		id: 'calendar',
		name: 'Calendar view',
		type: 'calendar',
		layout: rawLayout ?? 'month',
		'week-starts-on': rawWeekStartsOn ?? 'locale',
	};
	return parseCalendarEntry(raw, 'legacy-calendar-view', 'calendar', 'Calendar view', {
		layout: SAVED_VIEW_KEYS.legacyLayout,
		weekStartsOn: SAVED_VIEW_KEYS.legacyWeekStartsOn,
	});
}

function parseLegacyBoardEntry(
	frontmatter: Record<string, unknown>,
	context: SavedViewValidationContext,
): ParsedEntry {
	const rawGroupBy = frontmatter[SAVED_VIEW_KEYS.legacyBoardGroupProperty];
	const raw: Record<string, unknown> = {
		id: 'board',
		name: 'Board',
		type: 'board',
	};
	if (rawGroupBy !== undefined && rawGroupBy !== null && rawGroupBy !== '') {
		raw['group-by'] = rawGroupBy;
	}
	return parseBoardEntry(
		raw,
		SAVED_VIEW_KEYS.legacyBoardGroupProperty,
		'board',
		'Board',
		context,
		SAVED_VIEW_KEYS.legacyBoardGroupProperty,
	);
}

function parseLegacyCatalog(
	frontmatter: Record<string, unknown>,
	context: SavedViewValidationContext,
): SavedViewCatalogParseResult {
	const parsed = [parseLegacyCalendarEntry(frontmatter)];
	if (hasOwn(frontmatter, SAVED_VIEW_KEYS.legacyBoardGroupProperty)) {
		parsed.push(parseLegacyBoardEntry(frontmatter, context));
	}
	return {
		catalog: {
			source: 'legacy',
			entries: parsed.map(({ entry }) => entry),
			canMutate: true,
		},
		issues: parsed.flatMap(({ issues }) => issues),
	};
}

function preservedUnknownVersionEntries(rawViews: unknown[]): SavedViewCatalogEntry[] {
	return rawViews.map((raw) => unsupportedEntry(raw));
}

export function parseSavedViewCatalog(
	frontmatter: Record<string, unknown>,
	context: SavedViewValidationContext,
): SavedViewCatalogParseResult {
	const hasVersion = hasOwn(frontmatter, SAVED_VIEW_KEYS.version);
	const hasViews = hasOwn(frontmatter, SAVED_VIEW_KEYS.views);
	if (!hasVersion && !hasViews) return parseLegacyCatalog(frontmatter, context);

	const issues: ConfigIssue[] = [];
	let canMutate = true;
	const rawVersion = frontmatter[SAVED_VIEW_KEYS.version];
	const rawViewsValue = frontmatter[SAVED_VIEW_KEYS.views];
	if (!hasVersion || !hasViews) {
		issues.push({
			field: !hasVersion ? SAVED_VIEW_KEYS.version : SAVED_VIEW_KEYS.views,
			message: 'Saved-view version and list must be provided together.',
		});
		canMutate = false;
	}
	const knownVersion = rawVersion === SAVED_VIEW_SCHEMA_VERSION;
	if (hasVersion && !knownVersion) {
		issues.push({
			field: SAVED_VIEW_KEYS.version,
			message: `Must be ${SAVED_VIEW_SCHEMA_VERSION}.`,
		});
		canMutate = false;
	}

	let entries: SavedViewCatalogEntry[] = [];
	if (hasViews && !Array.isArray(rawViewsValue)) {
		issues.push({ field: SAVED_VIEW_KEYS.views, message: 'Must be a non-empty list.' });
		canMutate = false;
	} else if (Array.isArray(rawViewsValue)) {
		if (rawViewsValue.length === 0) {
			issues.push({ field: SAVED_VIEW_KEYS.views, message: 'Must contain at least one view.' });
			canMutate = false;
		}
		if (hasVersion && !knownVersion) {
			entries = preservedUnknownVersionEntries(rawViewsValue);
		} else {
			const duplicates = duplicateIds(rawViewsValue);
			const duplicateViewNames = duplicateNames(rawViewsValue);
			const parsed = rawViewsValue.map((raw, index) =>
				parseCanonicalEntry(
					raw,
					index,
					duplicates,
					duplicateViewNames,
					context,
				),
			);
			entries = parsed.map(({ entry }) => entry);
			issues.push(...parsed.flatMap(({ issues: entryIssues }) => entryIssues));
			if (parsed.some(({ structuralIssue }) => structuralIssue)) canMutate = false;
		}
	}

	for (const legacyKey of [
		SAVED_VIEW_KEYS.legacyLayout,
		SAVED_VIEW_KEYS.legacyWeekStartsOn,
		SAVED_VIEW_KEYS.legacyBoardGroupProperty,
	]) {
		if (!hasOwn(frontmatter, legacyKey)) continue;
		issues.push({
			field: legacyKey,
			message: 'Ignored because calendar-views is the canonical source.',
		});
	}

	return {
		catalog: { source: 'canonical', entries, canMutate },
		issues,
	};
}

export function createDefaultSavedViewCatalog(
	layout: CalendarLayout = 'month',
	weekStartsOn: WeekStartsOn = 'locale',
): SavedViewCatalog {
	return {
		source: 'canonical',
		entries: [
			{
				kind: 'valid',
				definition: {
					id: 'calendar',
					name: 'Calendar view',
					type: 'calendar',
					layout,
					weekStartsOn,
				},
			},
		],
		canMutate: true,
	};
}

function serializeSavedView(view: SavedView): Record<string, unknown> {
	if (view.type === 'calendar') {
		return {
			id: view.id,
			name: view.name,
			type: view.type,
			layout: view.layout,
			'week-starts-on': view.weekStartsOn,
		};
	}
	const serialized: Record<string, unknown> = {
		id: view.id,
		name: view.name,
		type: view.type,
	};
	if (view.groupBy) serialized['group-by'] = view.groupBy;
	return serialized;
}

export function serializeSavedViewCatalog(
	catalog: SavedViewCatalog,
): Record<string, unknown>[] {
	if (!catalog.canMutate) {
		throw new Error('Cannot rewrite a structurally invalid saved-view catalog.');
	}
	if (catalog.entries.length === 0) {
		throw new Error('A saved-view catalog must contain at least one entry.');
	}
	return catalog.entries.map((entry) =>
		entry.kind === 'valid'
			? serializeSavedView(entry.definition)
			: copyRaw(entry.raw) as Record<string, unknown>,
	);
}

export function applySavedViewCatalogToFrontmatter(
	frontmatter: Record<string, unknown>,
	catalog: SavedViewCatalog,
): boolean {
	if (!catalog.canMutate) return false;
	const views = serializeSavedViewCatalog(catalog);
	frontmatter[SAVED_VIEW_KEYS.version] = SAVED_VIEW_SCHEMA_VERSION;
	frontmatter[SAVED_VIEW_KEYS.views] = views;
	delete frontmatter[SAVED_VIEW_KEYS.legacyLayout];
	delete frontmatter[SAVED_VIEW_KEYS.legacyWeekStartsOn];
	delete frontmatter[SAVED_VIEW_KEYS.legacyBoardGroupProperty];
	return true;
}

export function validSavedViews(catalog: SavedViewCatalog): SavedView[] {
	return catalog.entries.flatMap((entry) =>
		entry.kind === 'valid' ? [entry.definition] : [],
	);
}

export function firstCalendarSavedView(
	catalog: SavedViewCatalog,
): CalendarSavedView | undefined {
	return validSavedViews(catalog).find(
		(view): view is CalendarSavedView => view.type === 'calendar',
	);
}
