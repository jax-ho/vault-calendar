import type {
	CalendarColor,
	CalendarConfig,
	CalendarPropertyDefinition,
} from '../types';

export const CALENDAR_COLORS: readonly CalendarColor[] = [
	'default',
	'gray',
	'brown',
	'orange',
	'yellow',
	'green',
	'blue',
	'purple',
	'pink',
	'red',
];

export const CALENDAR_COLOR_LABELS: Record<CalendarColor, string> = {
	default: 'Default',
	gray: 'Gray',
	brown: 'Brown',
	orange: 'Orange',
	yellow: 'Yellow',
	green: 'Green',
	blue: 'Blue',
	purple: 'Purple',
	pink: 'Pink',
	red: 'Red',
};

export function isCalendarColor(value: unknown): value is CalendarColor {
	return typeof value === 'string' && CALENDAR_COLORS.includes(value as CalendarColor);
}

export function selectOptionColor(
	definition: CalendarPropertyDefinition | undefined,
	value: unknown,
): CalendarColor {
	if (definition?.type !== 'select' || typeof value !== 'string') return 'default';
	return definition.colors?.[value] ?? 'default';
}

export function calendarCardColor(
	config: CalendarConfig,
	properties: Record<string, unknown>,
): CalendarColor {
	const property = config.cardColorProperty;
	if (!property) return 'default';
	return selectOptionColor(config.propertyDefinitions[property], properties[property]);
}
