import { setIcon, type App } from 'obsidian';
import { selectOptionColor } from '../domain/calendar-colors';
import type {
	CalendarItem,
	CalendarPropertyDefinition,
} from '../types';

const INTERNAL_LINK_PATTERN = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/u;

function parentItemTitle(item: CalendarItem): string | undefined {
	const parent = item.parentItem;
	if (!parent) return undefined;
	return parent.title.trim() || parent.path;
}

function subItemCountLabel(count: number): string {
	return `${count} ${count === 1 ? 'sub-item' : 'sub-items'}`;
}

export function calendarRelationshipRowCount(item: CalendarItem): number {
	return Number(Boolean(item.parentItem)) + Number(item.subItems.length > 0);
}

export function calendarRelationshipAccessibleSummary(item: CalendarItem): string {
	const parts: string[] = [];
	const parentTitle = parentItemTitle(item);
	if (parentTitle) parts.push(`Parent item: ${parentTitle}`);
	if (item.subItems.length > 0) {
		parts.push(subItemCountLabel(item.subItems.length));
	}
	return parts.join(', ');
}

function renderRelationshipIcon(
	row: HTMLElement,
	iconName: 'corner-down-right' | 'list-tree',
): void {
	const icon = row.createSpan({ cls: 'cv-card-relationship-icon' });
	icon.setAttribute('aria-hidden', 'true');
	setIcon(icon, iconName);
}

export function renderCardRelationships(
	card: HTMLElement,
	item: CalendarItem,
): void {
	if (calendarRelationshipRowCount(item) === 0) return;

	const relationships = card.createDiv({ cls: 'cv-card-relationships' });
	const parentTitle = parentItemTitle(item);
	if (item.parentItem && parentTitle) {
		card.addClass('has-parent');
		const row = relationships.createDiv({
			cls: 'cv-card-relationship is-parent',
		});
		row.dataset.path = item.parentItem.path;
		renderRelationshipIcon(row, 'corner-down-right');
		const text = `Parent: ${parentTitle}`;
		row.createSpan({ cls: 'cv-card-relationship-text', text });
		row.setAttribute('title', text);
	}

	if (item.subItems.length > 0) {
		card.addClass('has-sub-items');
		const row = relationships.createDiv({
			cls: 'cv-card-relationship is-sub-items',
		});
		row.dataset.count = String(item.subItems.length);
		renderRelationshipIcon(row, 'list-tree');
		const text = subItemCountLabel(item.subItems.length);
		row.createSpan({ cls: 'cv-card-relationship-text', text });
		row.setAttribute('title', text);
	}
}

function propertyDisplayName(property: string): string {
	const words = property.replaceAll(/[-_]+/gu, ' ');
	return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

function renderScalar(
	app: App,
	container: HTMLElement,
	value: unknown,
	sourcePath: string,
): void {
	if (typeof value === 'boolean') {
		const checkbox = container.createEl('input', {
			cls: 'cv-property-checkbox',
			type: 'checkbox',
			attr: {
				'aria-hidden': 'true',
				tabindex: '-1',
			},
		});
		checkbox.checked = value;
		checkbox.disabled = true;
		return;
	}
	const text = String(value);
	const linkMatch = INTERNAL_LINK_PATTERN.exec(text);
	if (linkMatch?.[1]) {
		const target = linkMatch[1];
		const link = container.createEl('a', {
			cls: 'internal-link cv-property-link',
			text: linkMatch[2] ?? target,
			href: target,
		});
		link.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			void app.workspace.openLinkText(
				target,
				sourcePath,
				event.metaKey || event.ctrlKey,
			);
		});
		return;
	}
	container.createSpan({ text });
}

export function renderCardProperties(
	app: App,
	card: HTMLElement,
	item: CalendarItem,
	visibleProperties: string[],
	propertyDefinitions: Record<string, CalendarPropertyDefinition>,
	cardColorProperty?: string,
): void {
	const propertiesEl = card.createDiv({ cls: 'cv-card-properties' });
	for (const property of visibleProperties) {
		const value = item.properties[property];
		if (value === undefined || value === null || value === '') continue;
		if (Array.isArray(value) && value.length === 0) continue;
		const row = propertiesEl.createDiv({ cls: 'cv-card-property' });
		row.dataset.property = property;
		row.createSpan({ cls: 'cv-property-name', text: propertyDisplayName(property) });
		const valueEl = row.createSpan({ cls: 'cv-property-value' });
		const definition = propertyDefinitions[property];
		if (typeof value === 'boolean') row.addClass('is-checkbox');
		if (Array.isArray(value)) {
			for (const part of value) {
				const chip = valueEl.createSpan({ cls: 'cv-property-chip cv-color-token' });
				chip.dataset.color = selectOptionColor(definition, part);
				if (property === cardColorProperty) {
					chip.addClass('has-color-dot');
					chip.createSpan({ cls: 'cv-property-color-dot' });
				}
				renderScalar(app, chip, part, item.path);
			}
		} else if (definition?.type === 'select') {
			const chip = valueEl.createSpan({ cls: 'cv-property-chip cv-color-token' });
			chip.dataset.color = selectOptionColor(definition, value);
			if (property === cardColorProperty) {
				chip.addClass('has-color-dot');
				chip.createSpan({ cls: 'cv-property-color-dot' });
			}
			renderScalar(app, chip, value, item.path);
		} else {
			renderScalar(app, valueEl, value, item.path);
		}
	}
	if (!propertiesEl.hasChildNodes()) propertiesEl.remove();
}
