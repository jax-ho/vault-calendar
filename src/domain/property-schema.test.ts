import { describe, expect, it } from 'vitest';
import type { CalendarConfig } from '../types';
import {
	addCalendarProperty,
	createPropertyDefinition,
	moveCalendarProperty,
	removeCalendarProperty,
	renameCalendarProperty,
	setCalendarPropertyVisibility,
	uniquePropertyName,
	updateCalendarProperty,
} from './property-schema';

function config(): CalendarConfig {
	return {
		documentPath: 'Life/Work/_calendar.md',
		name: 'Work',
		sourceFolder: 'Life/Work',
		recursive: true,
		startDateProperty: 'date',
		endDateProperty: 'date-end',
		visibleProperties: ['Status', 'Type'],
		propertyDefinitions: {
			Status: createPropertyDefinition('select'),
			Type: createPropertyDefinition('select'),
		},
		cardColorProperty: 'Status',
		weekStartsOn: 'monday',
		layout: 'month',
		openBehavior: 'same-leaf',
		createFolder: 'Life/Work',
		excludePaths: [],
	};
}

describe('calendar property schema management', () => {
	it('adds new visible properties with type defaults', () => {
		const next = addCalendarProperty(
			config(),
			'Important',
			createPropertyDefinition('checkbox'),
		);
		expect(next.visibleProperties).toEqual(['Status', 'Type', 'Important']);
		expect(next.propertyDefinitions.Important).toEqual({
			type: 'checkbox',
			default: false,
		});
	});

	it('renames properties without changing their order or color linkage', () => {
		const next = renameCalendarProperty(config(), 'Status', 'Progress');
		expect(Object.keys(next.propertyDefinitions)).toEqual(['Progress', 'Type']);
		expect(next.visibleProperties).toEqual(['Progress', 'Type']);
		expect(next.cardColorProperty).toBe('Progress');
	});

	it('updates, reorders, hides, and removes properties consistently', () => {
		let next = updateCalendarProperty(config(), 'Type', {
			type: 'text',
			default: 'Task',
		});
		next = moveCalendarProperty(next, 'Type', -1);
		expect(Object.keys(next.propertyDefinitions)).toEqual(['Type', 'Status']);
		expect(next.visibleProperties).toEqual(['Type', 'Status']);
		next = setCalendarPropertyVisibility(next, 'Type', false);
		expect(next.visibleProperties).toEqual(['Status']);
		next = removeCalendarProperty(next, 'Status');
		expect(Object.keys(next.propertyDefinitions)).toEqual(['Type']);
		expect(next.cardColorProperty).toBeUndefined();
	});

	it('creates deterministic unique names and rejects case-insensitive duplicates', () => {
		expect(uniquePropertyName(config().propertyDefinitions)).toBe('Property');
		const withProperty = addCalendarProperty(
			config(),
			'Property',
			createPropertyDefinition('text'),
		);
		expect(uniquePropertyName(withProperty.propertyDefinitions)).toBe('Property 2');
		expect(() =>
			addCalendarProperty(config(), 'status', createPropertyDefinition('text')),
		).toThrow('Property already exists: Status');
	});

	it('reserves title for the built-in event title field', () => {
		expect(() =>
			addCalendarProperty(config(), 'title', createPropertyDefinition('text')),
		).toThrow('Property name is reserved: title');
		expect(() =>
			renameCalendarProperty(config(), 'Status', 'TITLE'),
		).toThrow('Property name is reserved: title');
	});
});
