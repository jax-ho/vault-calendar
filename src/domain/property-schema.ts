import type {
	CalendarConfig,
	CalendarPropertyDefinition,
	CalendarPropertyType,
} from '../types';
import { copyCalendarPropertyDefinition } from './calendar-copy';
import { isReservedEventProperty } from './reserved-properties';

function orderedVisibleProperties(
	propertyDefinitions: Record<string, CalendarPropertyDefinition>,
	visibleProperties: Iterable<string>,
): string[] {
	const visible = new Set(visibleProperties);
	return Object.keys(propertyDefinitions).filter((property) => visible.has(property));
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

export function validatePropertyName(
	propertyDefinitions: Record<string, CalendarPropertyDefinition>,
	name: string,
	currentName?: string,
): string {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Enter a property name.');
	if (isReservedEventProperty(trimmed)) {
		throw new Error('Property name is reserved: title');
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
	return {
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
}

export function updateCalendarProperty(
	config: CalendarConfig,
	name: string,
	definition: CalendarPropertyDefinition,
): CalendarConfig {
	if (!config.propertyDefinitions[name]) throw new Error(`Property not found: ${name}`);
	return {
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
	return {
		...config,
		propertyDefinitions,
		visibleProperties: config.visibleProperties.filter((property) => property !== name),
		cardColorProperty:
			config.cardColorProperty === name ? undefined : config.cardColorProperty,
	};
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
