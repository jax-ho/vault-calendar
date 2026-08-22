export const UI_LOCALE = 'en-US';

export function applyUiLocale(element: HTMLElement | undefined): void {
	if (element) element.lang = UI_LOCALE;
}
