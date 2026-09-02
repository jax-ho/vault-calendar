import { eventPropertyControl } from './event-property-controls';
import type { CalendarConfig } from '../types';
import {
	EVENT_PARENT_ITEM_PROPERTY,
	RESERVED_EVENT_PROPERTIES,
} from './reserved-properties';

export function createEventPropertyDraft(
	config: CalendarConfig,
): Record<string, unknown> {
	const reservedProperties = new Set([
		...RESERVED_EVENT_PROPERTIES,
		config.startDateProperty,
		config.endDateProperty,
	]);
	const properties: Record<string, unknown> = {
		[EVENT_PARENT_ITEM_PROPERTY]: undefined,
	};

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
