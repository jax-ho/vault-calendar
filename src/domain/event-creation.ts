import { eventPropertyControl } from './event-property-controls';
import type { CalendarConfig } from '../types';
import { EVENT_TITLE_PROPERTY } from './reserved-properties';

export function createEventPropertyDraft(
	config: CalendarConfig,
): Record<string, unknown> {
	const reservedProperties = new Set([
		EVENT_TITLE_PROPERTY,
		config.startDateProperty,
		config.endDateProperty,
	]);
	const properties: Record<string, unknown> = {};

	for (const [property, definition] of Object.entries(config.propertyDefinitions)) {
		if (reservedProperties.has(property)) continue;
		const control = eventPropertyControl(definition);
		if (definition.default !== undefined) {
			properties[property] = definition.default;
		} else if (control.kind === 'select') {
			properties[property] = control.options[0] ?? 'None';
		} else if (control.kind === 'checkbox') {
			properties[property] = false;
		} else {
			properties[property] = undefined;
		}
	}

	return properties;
}
