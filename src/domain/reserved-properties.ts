export const EVENT_TITLE_PROPERTY = 'title';

export function isReservedEventProperty(name: string): boolean {
	return name.trim().toLocaleLowerCase() === EVENT_TITLE_PROPERTY;
}
