import { Setting, setIcon } from 'obsidian';
import {
	propertyTypeIcon,
	propertyTypeLabel,
} from '../domain/property-type-icons';
import {
	moveCalendarProperty,
	removeCalendarProperty,
	setCalendarPropertyVisibility,
} from '../domain/property-schema';
import type {
	CalendarConfig,
	CalendarPropertyDefinition,
} from '../types';

interface PropertyManagerCallbacks {
	onAdd: () => void;
	onEdit: (property: string) => void;
	onChange: (config: CalendarConfig) => void;
}

function defaultSummary(definition: CalendarPropertyDefinition): string {
	const type = propertyTypeLabel(definition.type);
	if (definition.default === undefined) return type;
	if (definition.type === 'checkbox') {
		return `${type} · Default: ${definition.default ? 'Checked' : 'Unchecked'}`;
	}
	return `${type} · Default: ${String(definition.default)}`;
}

export function renderPropertyManager(
	container: HTMLElement,
	config: CalendarConfig,
	callbacks: PropertyManagerCallbacks,
): void {
	container.empty();
	const entries = Object.entries(config.propertyDefinitions);
	const list = container.createDiv({ cls: 'cv-property-manager-list' });

	for (const [index, [property, definition]] of entries.entries()) {
		const setting = new Setting(list)
			.setClass('cv-property-manager-row')
			.setName(property)
			.setDesc(defaultSummary(definition));
		const icon = setting.infoEl.createSpan({ cls: 'cv-property-manager-icon' });
		setIcon(icon, propertyTypeIcon(definition.type));
		setting.infoEl.prepend(icon);
		setting.controlEl.createSpan({
			cls: 'cv-property-visibility-label',
			text: 'On card',
		});
		setting.addToggle((toggle) => {
			toggle
				.setTooltip('Show on event cards')
				.setValue(config.visibleProperties.includes(property))
				.onChange((visible) => {
					callbacks.onChange(setCalendarPropertyVisibility(config, property, visible));
				});
		});
		setting.addExtraButton((button) => {
			button
				.setIcon('chevron-up')
				.setTooltip('Move up')
				.setDisabled(index === 0)
				.onClick(() => {
					callbacks.onChange(moveCalendarProperty(config, property, -1));
				});
		});
		setting.addExtraButton((button) => {
			button
				.setIcon('chevron-down')
				.setTooltip('Move down')
				.setDisabled(index === entries.length - 1)
				.onClick(() => {
					callbacks.onChange(moveCalendarProperty(config, property, 1));
				});
		});
		setting.addExtraButton((button) => {
			button
				.setIcon('pencil')
				.setTooltip(`Edit ${property}`)
				.onClick(() => callbacks.onEdit(property));
		});
		setting.addExtraButton((button) => {
			button
				.setIcon('trash-2')
				.setTooltip(`Delete ${property}`)
				.onClick(() => {
					const confirmed = container.ownerDocument.defaultView?.confirm(
						`Delete the ${property} property from this calendar? Existing event notes will not be changed.`,
					);
					if (confirmed) {
						callbacks.onChange(removeCalendarProperty(config, property));
					}
				});
		});
	}

	new Setting(container)
		.setClass('cv-property-manager-add')
		.setName('Add property')
		.setDesc('Define a field for new events and event cards.')
		.addButton((button) => {
			button.setButtonText('Add property').onClick(callbacks.onAdd);
		});

	const selectProperties = entries.filter(([, definition]) => definition.type === 'select');
	new Setting(container)
		.setClass('cv-property-manager-color')
		.setName('Card color')
		.setDesc('Link event card color to one select property.')
		.addDropdown((dropdown) => {
			dropdown.addOption('', 'No color');
			for (const [property] of selectProperties) dropdown.addOption(property, property);
			dropdown
				.setValue(config.cardColorProperty ?? '')
				.setDisabled(selectProperties.length === 0)
				.onChange((property) => {
					const next = { ...config };
					if (property) next.cardColorProperty = property;
					else delete next.cardColorProperty;
					callbacks.onChange(next);
				});
		});
}
