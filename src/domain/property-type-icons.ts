import type {
	CalendarPropertyDefinition,
	CalendarPropertyType,
} from '../types';

export type EventFieldType =
	| CalendarPropertyType
	| 'date'
	| 'relation'
	| 'relations';

const PROPERTY_TYPE_ICONS: Record<EventFieldType, string> = {
	date: 'calendar-days',
	select: 'circle-chevron-down',
	checkbox: 'square-check-big',
	text: 'type',
	number: 'hash',
	relation: 'corner-down-right',
	relations: 'list-tree',
};

const PROPERTY_TYPE_LABELS: Record<CalendarPropertyType, string> = {
	select: 'Select',
	checkbox: 'Checkbox',
	text: 'Text',
	number: 'Number',
};

export function propertyTypeIcon(type: EventFieldType): string {
	return PROPERTY_TYPE_ICONS[type];
}

export function propertyTypeLabel(type: CalendarPropertyType): string {
	return PROPERTY_TYPE_LABELS[type];
}

export function resolvedPropertyType(
	definition: CalendarPropertyDefinition | undefined,
	value: unknown,
): CalendarPropertyType {
	if (definition) return definition.type;
	if (typeof value === 'boolean') return 'checkbox';
	if (typeof value === 'number') return 'number';
	return 'text';
}
