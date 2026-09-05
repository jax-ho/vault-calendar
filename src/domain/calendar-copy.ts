import type {
	CalendarConfig,
	CalendarPropertyDefinition,
	SavedView,
	SavedViewCatalog,
	SavedViewCatalogEntry,
} from '../types';

export function copyCalendarPropertyDefinition(
	definition: CalendarPropertyDefinition,
): CalendarPropertyDefinition {
	const copy: CalendarPropertyDefinition = { type: definition.type };
	if (definition.options) copy.options = [...definition.options];
	if (definition.colors) copy.colors = { ...definition.colors };
	if (definition.default !== undefined) copy.default = definition.default;
	return copy;
}

export function copyCalendarPropertyDefinitions(
	definitions: Record<string, CalendarPropertyDefinition>,
): Record<string, CalendarPropertyDefinition> {
	return Object.fromEntries(
		Object.entries(definitions).map(([property, definition]) => [
			property,
			copyCalendarPropertyDefinition(definition),
		]),
	);
}

export function copySavedView(view: SavedView): SavedView {
	return { ...view };
}

function copySavedViewCatalogEntry(entry: SavedViewCatalogEntry): SavedViewCatalogEntry {
	if (entry.kind === 'valid') {
		const copy: SavedViewCatalogEntry = {
			kind: 'valid',
			definition: copySavedView(entry.definition),
		};
		if (entry.warnings) {
			copy.warnings = entry.warnings.map((warning) => ({ ...warning }));
		}
		return copy;
	}
	if (entry.kind === 'invalid') {
		const copy: SavedViewCatalogEntry = {
			kind: 'invalid',
			raw: structuredClone(entry.raw),
			issues: entry.issues.map((issue) => ({ ...issue })),
		};
		if (entry.id !== undefined) copy.id = entry.id;
		if (entry.name !== undefined) copy.name = entry.name;
		return copy;
	}
	const copy: SavedViewCatalogEntry = {
		kind: 'unsupported',
		raw: structuredClone(entry.raw),
	};
	if (entry.id !== undefined) copy.id = entry.id;
	if (entry.name !== undefined) copy.name = entry.name;
	if (entry.viewType !== undefined) copy.viewType = entry.viewType;
	return copy;
}

export function copySavedViewCatalog(catalog: SavedViewCatalog): SavedViewCatalog {
	return {
		source: catalog.source,
		entries: catalog.entries.map(copySavedViewCatalogEntry),
		canMutate: catalog.canMutate,
	};
}

export function copyCalendarConfig(config: CalendarConfig): CalendarConfig {
	const copy: CalendarConfig = {
		...config,
		visibleProperties: [...config.visibleProperties],
		propertyDefinitions: copyCalendarPropertyDefinitions(config.propertyDefinitions),
		excludePaths: [...config.excludePaths],
	};
	if (config.viewCatalog) copy.viewCatalog = copySavedViewCatalog(config.viewCatalog);
	return copy;
}
