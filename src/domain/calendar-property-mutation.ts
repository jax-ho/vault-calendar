import { copyCalendarPropertyDefinition } from './calendar-copy';
import {
	addCalendarProperty,
	removeCalendarProperty,
	sameCalendarPropertyDefinition,
	setCalendarPropertyVisibility,
	updateCalendarProperty,
} from './property-schema';
import type {
	CalendarConfig,
	CalendarPropertyDefinition,
} from '../types';

export type CalendarPropertyMutation =
	| {
			kind: 'add';
			property: string;
			definition: CalendarPropertyDefinition;
	  }
	| {
			kind: 'update';
			property: string;
			expectedDefinition: CalendarPropertyDefinition;
			definition: CalendarPropertyDefinition;
	  }
	| {
			kind: 'remove';
			property: string;
			expectedDefinition: CalendarPropertyDefinition;
	  }
	| {
			kind: 'reorder';
			expectedOrder: readonly string[];
			order: readonly string[];
	  }
	| {
			kind: 'set-visibility';
			property: string;
			expectedVisible: boolean;
			visible: boolean;
	  }
	| {
			kind: 'set-card-color';
			expectedProperty: string | undefined;
			property: string | undefined;
	  };

function propertyConflict(documentPath: string, property: string): Error {
	return new Error(
		`${property} changed in another tab or pane. Refresh settings and try again: ${documentPath}`,
	);
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

export function applyCalendarPropertyMutation(
	config: CalendarConfig,
	mutation: CalendarPropertyMutation,
): CalendarConfig {
	if (mutation.kind === 'add') {
		const current = config.propertyDefinitions[mutation.property];
		if (current) {
			if (sameCalendarPropertyDefinition(current, mutation.definition)) return config;
			throw propertyConflict(config.documentPath, mutation.property);
		}
		return addCalendarProperty(config, mutation.property, mutation.definition);
	}

	if (mutation.kind === 'update') {
		const current = config.propertyDefinitions[mutation.property];
		if (sameCalendarPropertyDefinition(current, mutation.definition)) return config;
		if (!sameCalendarPropertyDefinition(current, mutation.expectedDefinition)) {
			throw propertyConflict(config.documentPath, mutation.property);
		}
		return updateCalendarProperty(config, mutation.property, mutation.definition);
	}

	if (mutation.kind === 'remove') {
		const current = config.propertyDefinitions[mutation.property];
		if (!current) return config;
		if (!sameCalendarPropertyDefinition(current, mutation.expectedDefinition)) {
			throw propertyConflict(config.documentPath, mutation.property);
		}
		return removeCalendarProperty(config, mutation.property);
	}

	if (mutation.kind === 'reorder') {
		const expected = [...mutation.expectedOrder];
		const order = [...mutation.order];
		if (
			expected.length !== new Set(expected).size ||
			order.length !== expected.length ||
			order.some((property) => !expected.includes(property))
		) {
			throw new Error('Property order mutation is invalid.');
		}
		const expectedSet = new Set(expected);
		const currentOrder = Object.keys(config.propertyDefinitions);
		const currentExpectedOrder = currentOrder.filter((property) =>
			expectedSet.has(property),
		);
		if (currentExpectedOrder.length !== expected.length) {
			throw propertyConflict(config.documentPath, 'Property order');
		}
		if (sameOrder(currentExpectedOrder, order)) return config;
		if (!sameOrder(currentExpectedOrder, expected)) {
			throw propertyConflict(config.documentPath, 'Property order');
		}
		let nextIndex = 0;
		const nextOrder = currentOrder.map((property) =>
			expectedSet.has(property) ? order[nextIndex++] ?? property : property,
		);
		const propertyDefinitions = Object.fromEntries(
			nextOrder.map((property) => [
				property,
				copyCalendarPropertyDefinition(config.propertyDefinitions[property]!),
			]),
		);
		const visible = new Set(config.visibleProperties);
		return {
			...config,
			propertyDefinitions,
			visibleProperties: nextOrder.filter((property) => visible.has(property)),
		};
	}

	if (mutation.kind === 'set-visibility') {
		if (!config.propertyDefinitions[mutation.property]) {
			throw propertyConflict(config.documentPath, mutation.property);
		}
		const currentVisible = config.visibleProperties.includes(mutation.property);
		if (currentVisible === mutation.visible) return config;
		if (currentVisible !== mutation.expectedVisible) {
			throw propertyConflict(config.documentPath, mutation.property);
		}
		return setCalendarPropertyVisibility(
			config,
			mutation.property,
			mutation.visible,
		);
	}

	if (config.cardColorProperty === mutation.property) return config;
	if (config.cardColorProperty !== mutation.expectedProperty) {
		throw propertyConflict(config.documentPath, 'Card color property');
	}
	if (
		mutation.property &&
		config.propertyDefinitions[mutation.property]?.type !== 'select'
	) {
		throw propertyConflict(config.documentPath, mutation.property);
	}
	const next = { ...config };
	if (mutation.property) next.cardColorProperty = mutation.property;
	else delete next.cardColorProperty;
	return next;
}

export function copyCalendarPropertyMutation(
	mutation: CalendarPropertyMutation,
): CalendarPropertyMutation {
	if (mutation.kind === 'add') {
		return {
			...mutation,
			definition: copyCalendarPropertyDefinition(mutation.definition),
		};
	}
	if (mutation.kind === 'update') {
		return {
			...mutation,
			expectedDefinition: copyCalendarPropertyDefinition(
				mutation.expectedDefinition,
			),
			definition: copyCalendarPropertyDefinition(mutation.definition),
		};
	}
	if (mutation.kind === 'remove') {
		return {
			...mutation,
			expectedDefinition: copyCalendarPropertyDefinition(
				mutation.expectedDefinition,
			),
		};
	}
	if (mutation.kind === 'reorder') {
		return {
			...mutation,
			expectedOrder: [...mutation.expectedOrder],
			order: [...mutation.order],
		};
	}
	return { ...mutation };
}
