import { setIcon } from 'obsidian';
import {
	propertyTypeIcon,
	type EventFieldType,
} from '../domain/property-type-icons';

export function renderEventFieldLabel(
	container: HTMLElement,
	label: string,
	type: EventFieldType,
): HTMLElement {
	const labelEl = container.createSpan({ cls: 'cv-event-editor-field-name' });
	const icon = labelEl.createSpan({ cls: 'cv-event-property-icon' });
	icon.setAttribute('aria-hidden', 'true');
	setIcon(icon, propertyTypeIcon(type));
	labelEl.createSpan({ cls: 'cv-event-property-label', text: label });
	return labelEl;
}
