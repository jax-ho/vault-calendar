import type {
	CalendarConfig,
	CalendarPropertyDefinition,
	CalendarPropertyType,
	SavedViewCatalogEntry,
} from '../types';
import { copyCalendarPropertyDefinition } from './calendar-copy';
import { reservedEventProperty } from './reserved-properties';
import { isWritableBoardGroupProperty } from './saved-views';

function orderedVisibleProperties(
	propertyDefinitions: Record<string, CalendarPropertyDefinition>,
	visibleProperties: Iterable<string>,
): string[] {
	const visible = new Set(visibleProperties);
	return Object.keys(propertyDefinitions).filter((property) => visible.has(property));
}

function updateBoardGroupReferences(
	config: CalendarConfig,
	currentName: string,
	nextName: string | undefined,
): CalendarConfig {
	if (!config.viewCatalog) return config;
	const entries: SavedViewCatalogEntry[] = config.viewCatalog.entries.map((entry) => {
		if (
			entry.kind !== 'valid' ||
			entry.definition.type !== 'board' ||
			entry.definition.groupBy !== currentName
		) {
			return entry;
		}
		return {
			kind: 'valid',
			definition: {
				...entry.definition,
				groupBy: nextName,
			},
		};
	});
	return {
		...config,
		viewCatalog: { ...config.viewCatalog, entries },
	};
}

export function clearInvalidBoardGroupReferences(
	config: CalendarConfig,
	properties: Iterable<string>,
): CalendarConfig {
	if (!config.viewCatalog) return config;
	const affected = new Set(properties);
	if (affected.size === 0) return config;
	let changed = false;
	const entries: SavedViewCatalogEntry[] = config.viewCatalog.entries.map((entry) => {
		if (
			entry.kind !== 'valid' ||
			entry.definition.type !== 'board' ||
			!entry.definition.groupBy ||
			!affected.has(entry.definition.groupBy) ||
			isWritableBoardGroupProperty(config, entry.definition.groupBy)
		) {
			return entry;
		}
		changed = true;
		return {
			kind: 'valid',
			definition: { ...entry.definition, groupBy: undefined },
		};
	});
	return changed
		? { ...config, viewCatalog: { ...config.viewCatalog, entries } }
		: config;
}

export function createPropertyDefinition(
	type: CalendarPropertyType,
): CalendarPropertyDefinition {
	if (type === 'select') {
		return {
			type,
			options: ['None'],
			colors: { None: 'default' },
			default: 'None',
		};
	}
	if (type === 'checkbox') return { type, default: false };
	return { type };
}

export function sameCalendarPropertyDefinition(
	left: CalendarPropertyDefinition | undefined,
	right: CalendarPropertyDefinition | undefined,
): boolean {
	if (!left || !right || left.type !== right.type || left.default !== right.default) {
		return left === right;
	}
	if (
		(left.options === undefined) !== (right.options === undefined) ||
		left.options?.length !== right.options?.length ||
		left.options?.some((option, index) => option !== right.options?.[index])
	) {
		return false;
	}
	const leftColors = Object.entries(left.colors ?? {}).sort(([leftKey], [rightKey]) =>
		leftKey.localeCompare(rightKey),
	);
	const rightColors = Object.entries(right.colors ?? {}).sort(([leftKey], [rightKey]) =>
		leftKey.localeCompare(rightKey),
	);
	return (
		leftColors.length === rightColors.length &&
		leftColors.every(
			([key, color], index) =>
				rightColors[index]?.[0] === key && rightColors[index]?.[1] === color,
		)
	);
}

export function validatePropertyName(
	propertyDefinitions: Record<string, CalendarPropertyDefinition>,
	name: string,
	currentName?: string,
): string {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Enter a property name.');
	const reservedProperty = reservedEventProperty(trimmed);
	if (reservedProperty) {
		throw new Error(`Property name is reserved: ${reservedProperty}`);
	}
	const duplicate = Object.keys(propertyDefinitions).find(
		(property) =>
			property !== currentName &&
			property.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
	);
	if (duplicate) throw new Error(`Property already exists: ${duplicate}`);
	return trimmed;
}

export function uniquePropertyName(
	propertyDefinitions: Record<string, CalendarPropertyDefinition>,
	base = 'Property',
): string {
	if (!Object.prototype.hasOwnProperty.call(propertyDefinitions, base)) return base;
	let index = 2;
	while (Object.prototype.hasOwnProperty.call(propertyDefinitions, `${base} ${index}`)) {
		index += 1;
	}
	return `${base} ${index}`;
}

export function addCalendarProperty(
	config: CalendarConfig,
	name: string,
	definition: CalendarPropertyDefinition,
): CalendarConfig {
	const property = validatePropertyName(config.propertyDefinitions, name);
	const propertyDefinitions = {
		...config.propertyDefinitions,
		[property]: copyCalendarPropertyDefinition(definition),
	};
	return {
		...config,
		propertyDefinitions,
		visibleProperties: orderedVisibleProperties(propertyDefinitions, [
			...config.visibleProperties,
			property,
		]),
	};
}

export function renameCalendarProperty(
	config: CalendarConfig,
	currentName: string,
	nextName: string,
): CalendarConfig {
	const definition = config.propertyDefinitions[currentName];
	if (!definition) throw new Error(`Property not found: ${currentName}`);
	const property = validatePropertyName(
		config.propertyDefinitions,
		nextName,
		currentName,
	);
	if (property === currentName) return config;
	const propertyDefinitions = Object.fromEntries(
		Object.entries(config.propertyDefinitions).map(([name, value]) => [
			name === currentName ? property : name,
			copyCalendarPropertyDefinition(value),
		]),
	);
	const next = {
		...config,
		propertyDefinitions,
		visibleProperties: config.visibleProperties.map((name) =>
			name === currentName ? property : name,
		),
		cardColorProperty:
			config.cardColorProperty === currentName
				? property
				: config.cardColorProperty,
	};
	return updateBoardGroupReferences(next, currentName, property);
}

export function updateCalendarProperty(
	config: CalendarConfig,
	name: string,
	definition: CalendarPropertyDefinition,
): CalendarConfig {
	if (!config.propertyDefinitions[name]) throw new Error(`Property not found: ${name}`);
	const wasWritableBoardGroup = isWritableBoardGroupProperty(config, name);
	const next = {
		...config,
		propertyDefinitions: Object.fromEntries(
			Object.entries(config.propertyDefinitions).map(([property, value]) => [
				property,
				property === name
					? copyCalendarPropertyDefinition(definition)
					: copyCalendarPropertyDefinition(value),
			]),
		),
		cardColorProperty:
			config.cardColorProperty === name && definition.type !== 'select'
				? undefined
				: config.cardColorProperty,
	};
	return wasWritableBoardGroup
		? clearInvalidBoardGroupReferences(next, [name])
		: next;
}

export function removeCalendarProperty(
	config: CalendarConfig,
	name: string,
): CalendarConfig {
	const propertyDefinitions = Object.fromEntries(
		Object.entries(config.propertyDefinitions)
			.filter(([property]) => property !== name)
			.map(([property, definition]) => [
				property,
				copyCalendarPropertyDefinition(definition),
			]),
	);
	const next = {
		...config,
		propertyDefinitions,
		visibleProperties: config.visibleProperties.filter((property) => property !== name),
		cardColorProperty:
			config.cardColorProperty === name ? undefined : config.cardColorProperty,
	};
	return clearInvalidBoardGroupReferences(
		updateBoardGroupReferences(next, name, undefined),
		[name],
	);
}

export function moveCalendarProperty(
	config: CalendarConfig,
	name: string,
	direction: -1 | 1,
): CalendarConfig {
	const entries = Object.entries(config.propertyDefinitions);
	const index = entries.findIndex(([property]) => property === name);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= entries.length) return config;
	const currentEntry = entries[index];
	const targetEntry = entries[target];
	if (!currentEntry || !targetEntry) return config;
	entries[index] = targetEntry;
	entries[target] = currentEntry;
	const propertyDefinitions = Object.fromEntries(entries);
	return {
		...config,
		propertyDefinitions,
		visibleProperties: orderedVisibleProperties(
			propertyDefinitions,
			config.visibleProperties,
		),
	};
}

export function setCalendarPropertyVisibility(
	config: CalendarConfig,
	name: string,
	visible: boolean,
): CalendarConfig {
	const nextVisible = new Set(config.visibleProperties);
	if (visible) nextVisible.add(name);
	else nextVisible.delete(name);
	return {
		...config,
		visibleProperties: orderedVisibleProperties(
			config.propertyDefinitions,
			nextVisible,
		),
	};
}
