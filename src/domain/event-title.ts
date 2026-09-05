export const EMPTY_EVENT_TITLE_DISPLAY = 'New page';

export function eventDisplayTitle(title: string): string {
	return title.trim() || EMPTY_EVENT_TITLE_DISPLAY;
}
