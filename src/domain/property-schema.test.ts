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
import {
	EVENT_PARENT_ITEM_PROPERTY,
	EVENT_SUB_ITEMS_PROPERTY,
	FIXED_EVENT_PROPERTIES,
} from './reserved-properties';

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

	it('publishes the fixed relationship contract', () => {
		expect(FIXED_EVENT_PROPERTIES).toEqual({
			[EVENT_PARENT_ITEM_PROPERTY]: {
				type: 'relation',
				cardinality: 'one',
				storage: 'frontmatter',
				writable: true,
			},
			[EVENT_SUB_ITEMS_PROPERTY]: {
				type: 'relation',
				cardinality: 'many',
				storage: 'derived',
				writable: false,
			},
		});
	});

	it('reserves built-in event fields with canonical error names', () => {
		expect(() =>
			addCalendarProperty(config(), 'title', createPropertyDefinition('text')),
		).toThrow('Property name is reserved: title');
		expect(() =>
			renameCalendarProperty(config(), 'Status', 'TITLE'),
		).toThrow('Property name is reserved: title');
		expect(() =>
			addCalendarProperty(config(), 'PARENT-ITEM', createPropertyDefinition('text')),
		).toThrow('Property name is reserved: parent-item');
		expect(() =>
			renameCalendarProperty(config(), 'Status', 'Sub-Items'),
		).toThrow('Property name is reserved: sub-items');
	});
});
