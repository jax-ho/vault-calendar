import type {
	CalendarConfig,
	CalendarPropertyDefinition,
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

export function copyCalendarConfig(config: CalendarConfig): CalendarConfig {
	return {
		...config,
		visibleProperties: [...config.visibleProperties],
		propertyDefinitions: copyCalendarPropertyDefinitions(config.propertyDefinitions),
		excludePaths: [...config.excludePaths],
	};
}
