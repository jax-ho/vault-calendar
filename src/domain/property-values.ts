import type { CalendarPropertyDefinition } from '../types';

export const SELECT_NONE_VALUE = 'None';

export function selectPropertyOptions(
	definition: CalendarPropertyDefinition,
): string[] {
	return [
		SELECT_NONE_VALUE,
		...(definition.options ?? []).filter((option) => option !== SELECT_NONE_VALUE),
	];
}

export function resolvedSelectValue(
	definition: CalendarPropertyDefinition,
	value: unknown,
): string {
	const options = selectPropertyOptions(definition);
	return typeof value === 'string' && options.includes(value)
		? value
		: SELECT_NONE_VALUE;
}

export function resolvedPropertyValue(
	definition: CalendarPropertyDefinition,
	value: unknown,
): unknown {
	const missing = value === undefined || value === null || value === '';
	const candidate = missing && definition.default !== undefined
		? definition.default
		: value;
	if (definition.type === 'select') {
		return resolvedSelectValue(definition, candidate);
	}
	return candidate;
}
