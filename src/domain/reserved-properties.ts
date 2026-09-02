export const EVENT_TITLE_PROPERTY = 'title';

export const EVENT_PARENT_ITEM_PROPERTY = 'parent-item';

export const EVENT_SUB_ITEMS_PROPERTY = 'sub-items';

export interface FixedEventPropertyDefinition {
	type: 'relation';
	cardinality: 'one' | 'many';
	storage: 'frontmatter' | 'derived';
	writable: boolean;
}

export const FIXED_EVENT_PROPERTIES = {
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
} as const satisfies Record<string, FixedEventPropertyDefinition>;

export type FixedEventProperty = keyof typeof FIXED_EVENT_PROPERTIES;

export const RESERVED_EVENT_PROPERTIES = [
	EVENT_TITLE_PROPERTY,
	EVENT_PARENT_ITEM_PROPERTY,
	EVENT_SUB_ITEMS_PROPERTY,
] as const;

export type ReservedEventProperty = (typeof RESERVED_EVENT_PROPERTIES)[number];

export function reservedEventProperty(
	name: string,
): ReservedEventProperty | undefined {
	const normalized = name.trim().toLocaleLowerCase();
	return RESERVED_EVENT_PROPERTIES.find((property) => property === normalized);
}

export function isReservedEventProperty(name: string): boolean {
	return reservedEventProperty(name) !== undefined;
}
