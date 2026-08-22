import type { CalendarPropertyDefinition } from '../types';
import { selectPropertyOptions } from './property-values';

export type EventPropertyControl =
	| { kind: 'select'; options: readonly string[] }
	| { kind: 'checkbox' }
	| { kind: 'text' }
	| { kind: 'number' }
	| { kind: 'inferred' };

export function eventPropertyControl(
	definition: CalendarPropertyDefinition | undefined,
): EventPropertyControl {
	if (!definition) return { kind: 'inferred' };
	switch (definition.type) {
		case 'select':
			return {
				kind: 'select',
				options: selectPropertyOptions(definition),
			};
		case 'checkbox':
			return { kind: 'checkbox' };
		case 'text':
			return { kind: 'text' };
		case 'number':
			return { kind: 'number' };
	}
}
