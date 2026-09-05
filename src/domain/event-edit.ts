import { compareDates, isPlainDate, parseCalendarDate } from './dates';
import { replaceCalendarDatePart } from './frontmatter-mutation';
import { normalizeParentItemLink } from './item-relations';
import { resolvedPropertyValue } from './property-values';
import {
	EVENT_PARENT_ITEM_PROPERTY,
	EVENT_TITLE_PROPERTY,
	RESERVED_EVENT_PROPERTIES,
} from './reserved-properties';
import type { CalendarPropertyDefinition } from '../types';

export interface EventFieldMapping {
	startDateProperty: string;
	endDateProperty?: string;
	visibleProperties: string[];
	propertyDefinitions: Record<string, CalendarPropertyDefinition>;
	validateParentItem?: (value: string | undefined) => void;
}

export interface EventEditDraft {
	title: string;
	start: string;
	end: string;
	properties: Record<string, unknown>;
	body: string;
}

function cloneValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		const items: unknown[] = value;
		return items.map((item) => cloneValue(item));
	}
	if (value && typeof value === 'object') return structuredClone(value);
	return value;
}

function editablePropertyNames(mapping: EventFieldMapping): string[] {
	const reserved = new Set([
		...RESERVED_EVENT_PROPERTIES,
		mapping.startDateProperty,
		mapping.endDateProperty,
	]);
	const configurableProperties = [
		...new Set([
			...Object.keys(mapping.propertyDefinitions),
			...mapping.visibleProperties,
		]),
	].filter((property) => !reserved.has(property));
	return [
		EVENT_PARENT_ITEM_PROPERTY,
		...configurableProperties,
	];
}

export function createEventEditDraft(
	frontmatter: Record<string, unknown>,
	body: string,
	mapping: EventFieldMapping,
	fallback: { title: string; start: string },
): EventEditDraft {
	const rawTitle = frontmatter[EVENT_TITLE_PROPERTY];
	const title =
		typeof rawTitle === 'string' || typeof rawTitle === 'number'
			? String(rawTitle)
			: fallback.title;
	const start = parseCalendarDate(frontmatter[mapping.startDateProperty]) ?? fallback.start;
	const end = mapping.endDateProperty
		? (parseCalendarDate(frontmatter[mapping.endDateProperty]) ?? '')
		: '';
	const properties: Record<string, unknown> = {};
	for (const property of editablePropertyNames(mapping)) {
		const storedValue = frontmatter[property];
		if (property === EVENT_PARENT_ITEM_PROPERTY) {
			properties[property] = typeof storedValue === 'string' ? storedValue : undefined;
			continue;
		}
		const definition = mapping.propertyDefinitions[property];
		properties[property] = cloneValue(
			definition
				? resolvedPropertyValue(definition, storedValue)
				: storedValue,
		);
	}
	return { title, start, end, properties, body };
}

export function copyEventEditDraft(draft: EventEditDraft): EventEditDraft {
	return {
		...draft,
		properties: Object.fromEntries(
			Object.entries(draft.properties).map(([key, value]) => [key, cloneValue(value)]),
		),
	};
}

export function validateEventEditDraft(
	draft: EventEditDraft,
	mapping: EventFieldMapping,
): void {
	if (!isPlainDate(draft.start)) throw new Error('Choose a valid start date.');
	if (
		Object.prototype.hasOwnProperty.call(
			draft.properties,
			EVENT_PARENT_ITEM_PROPERTY,
		)
	) {
		const parentItem = normalizeParentItemLink(
			draft.properties[EVENT_PARENT_ITEM_PROPERTY],
		);
		mapping.validateParentItem?.(parentItem);
	}
	if (mapping.endDateProperty && draft.end) {
		if (!isPlainDate(draft.end)) throw new Error('Choose a valid end date.');
		if (compareDates(draft.end, draft.start) < 0) {
			throw new Error('End date cannot be earlier than start date.');
		}
	}
}

export function applyEventEditDraft(
	frontmatter: Record<string, unknown>,
	draft: EventEditDraft,
	mapping: EventFieldMapping,
): void {
	validateEventEditDraft(draft, mapping);
	const title = draft.title.trim();
	frontmatter[EVENT_TITLE_PROPERTY] = title;

	const originalStart = frontmatter[mapping.startDateProperty];
	frontmatter[mapping.startDateProperty] = replaceCalendarDatePart(
		originalStart,
		draft.start,
	);
	if (mapping.endDateProperty) {
		if (draft.end && draft.end !== draft.start) {
			frontmatter[mapping.endDateProperty] = replaceCalendarDatePart(
				frontmatter[mapping.endDateProperty] ?? originalStart,
				draft.end,
			);
		} else {
			delete frontmatter[mapping.endDateProperty];
		}
	}

	for (const property of editablePropertyNames(mapping)) {
		const value = draft.properties[property];
		if (property === EVENT_PARENT_ITEM_PROPERTY) {
			if (!Object.prototype.hasOwnProperty.call(draft.properties, property)) continue;
			const parentItem = normalizeParentItemLink(value);
			if (parentItem) frontmatter[property] = parentItem;
			else delete frontmatter[property];
			continue;
		}
		if (
			value === undefined ||
			value === null ||
			value === '' ||
			(Array.isArray(value) && value.length === 0)
		) {
			delete frontmatter[property];
		} else {
			frontmatter[property] = cloneValue(value);
		}
	}
}
