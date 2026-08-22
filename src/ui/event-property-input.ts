import { selectOptionColor } from '../domain/calendar-colors';
import { eventPropertyControl } from '../domain/event-property-controls';
import { resolvedSelectValue } from '../domain/property-values';
import type { CalendarPropertyDefinition } from '../types';

function textInput(container: HTMLElement, value: string): HTMLInputElement {
	const input = container.createEl('input', { type: 'text' });
	input.value = value;
	return input;
}

export function renderEventPropertyInput(
	container: HTMLElement,
	property: string,
	definition: CalendarPropertyDefinition | undefined,
	value: unknown,
	onChange: (value: unknown) => void,
): void {
	const configuredControl = eventPropertyControl(definition);
	if (configuredControl.kind === 'checkbox') {
		const input = container.createEl('input', {
			cls: 'cv-event-property-checkbox',
			type: 'checkbox',
			attr: { 'aria-label': property },
		});
		input.checked = value === true;
		input.addEventListener('change', () => onChange(input.checked));
		return;
	}
	if (configuredControl.kind === 'select') {
		const selectWrap = container.createDiv({ cls: 'cv-colored-select cv-color-token' });
		const swatch = selectWrap.createSpan({ cls: 'cv-color-swatch' });
		swatch.setAttribute('aria-hidden', 'true');
		const select = selectWrap.createEl('select', {
			cls: 'dropdown cv-event-property-select',
			attr: { 'aria-label': property },
		});
		for (const option of configuredControl.options) {
			select.createEl('option', { text: option, value: option });
		}
		const currentValue = definition
			? resolvedSelectValue(definition, value)
			: (configuredControl.options[0] ?? 'None');
		select.value = currentValue;
		const updateColor = (): void => {
			selectWrap.dataset.color = selectOptionColor(definition, select.value);
		};
		updateColor();
		select.addEventListener('change', () => {
			updateColor();
			onChange(select.value);
		});
		return;
	}
	if (configuredControl.kind === 'number') {
		const input = container.createEl('input', { type: 'number' });
		input.value =
			typeof value === 'number' || typeof value === 'string' ? String(value) : '';
		input.addEventListener('input', () => {
			const parsed = Number(input.value);
			onChange(input.value.trim() && Number.isFinite(parsed) ? parsed : undefined);
		});
		return;
	}
	if (configuredControl.kind === 'text') {
		const input = textInput(
			container,
			typeof value === 'string' || typeof value === 'number' ? String(value) : '',
		);
		input.addEventListener('input', () => onChange(input.value));
		return;
	}
	if (typeof value === 'boolean') {
		const input = container.createEl('input', { type: 'checkbox' });
		input.checked = value;
		input.addEventListener('change', () => onChange(input.checked));
		return;
	}
	if (typeof value === 'number') {
		const input = container.createEl('input', { type: 'number' });
		input.value = String(value);
		input.addEventListener('input', () => {
			const parsed = Number(input.value);
			onChange(input.value.trim() && Number.isFinite(parsed) ? parsed : undefined);
		});
		return;
	}
	if (Array.isArray(value)) {
		const input = textInput(container, value.map(String).join(', '));
		input.addEventListener('input', () => {
			onChange(
				input.value
					.split(',')
					.map((part) => part.trim())
					.filter(Boolean),
			);
		});
		return;
	}
	if (value && typeof value === 'object') {
		container.createSpan({ cls: 'cv-event-property-readonly', text: 'Open note to edit' });
		return;
	}
	const input = textInput(container, typeof value === 'string' ? value : '');
	input.addEventListener('input', () => onChange(input.value));
}
