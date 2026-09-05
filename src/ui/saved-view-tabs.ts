import { Menu, setIcon, setTooltip } from 'obsidian';
import { isValidViewId, validSavedViews } from '../domain/saved-views';
import type {
	SavedView,
	SavedViewCatalog,
	SavedViewCatalogEntry,
	SavedViewType,
} from '../types';

export interface SavedViewTabModel {
	id: string;
	name: string;
	type?: SavedViewType;
	definition?: SavedView;
	unavailableReason?: string;
}

export interface SavedViewTabActions {
	onActivate(view: SavedView): void;
	onAdd(): void;
	onEdit(view: SavedView): void;
	onRename(view: SavedView): void;
	onDelete(view: SavedView): void;
}

function entryId(entry: SavedViewCatalogEntry): string | undefined {
	return entry.kind === 'valid' ? entry.definition.id : entry.id;
}

function entryName(entry: SavedViewCatalogEntry): string | undefined {
	return entry.kind === 'valid' ? entry.definition.name : entry.name;
}

export function savedViewTabModels(catalog: SavedViewCatalog): SavedViewTabModel[] {
	const idCounts = new Map<string, number>();
	for (const entry of catalog.entries) {
		const id = entryId(entry);
		if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
	}

	return catalog.entries.flatMap((entry): SavedViewTabModel[] => {
		const id = entryId(entry);
		if (!isValidViewId(id) || idCounts.get(id) !== 1) return [];
		if (entry.kind === 'valid') {
			return [
				{
					id,
					name: entry.definition.name,
					type: entry.definition.type,
					definition: entry.definition,
				},
			];
		}
		if (entry.kind === 'unsupported') {
			return [
				{
					id,
					name: entryName(entry) ?? 'Unsupported view',
					unavailableReason: entry.viewType
						? `Unsupported view type: ${entry.viewType}`
						: 'Unsupported saved view.',
				},
			];
		}
		return [
			{
				id,
				name: entryName(entry) ?? 'Unavailable view',
				unavailableReason:
					entry.issues.map(({ message }) => message).join(' ') ||
					'This saved view needs repair.',
			},
		];
	});
}

export function savedViewPanelId(prefix: string, viewId: string): string {
	return `${prefix}-saved-view-panel-${viewId}`;
}

function viewIcon(type: SavedViewType | undefined): string {
	if (type === 'calendar') return 'calendar-days';
	if (type === 'board') return 'columns-3';
	return 'circle-slash-2';
}

function showViewMenu(
	view: SavedView,
	catalog: SavedViewCatalog,
	actions: SavedViewTabActions,
	anchor: HTMLElement,
	event?: MouseEvent,
): void {
	const menu = new Menu();
	menu.addItem((item) => {
		item
			.setTitle('Edit view')
			.setIcon('sliders-horizontal')
			.onClick(() => actions.onEdit(view));
	});
	menu.addItem((item) => {
		item
			.setTitle('Rename')
			.setIcon('pencil')
			.onClick(() => actions.onRename(view));
	});
	menu.addSeparator();
	menu.addItem((item) => {
		item
			.setTitle('Delete view')
			.setIcon('trash-2')
			.setWarning(true)
			.setDisabled(validSavedViews(catalog).length <= 1)
			.onClick(() => actions.onDelete(view));
	});
	if (event) {
		menu.showAtMouseEvent(event);
		return;
	}
	const bounds = anchor.getBoundingClientRect();
	menu.showAtPosition(
		{ x: bounds.left, y: bounds.bottom },
		anchor.ownerDocument,
	);
}

function focusRelativeTab(
	strip: HTMLElement,
	current: HTMLButtonElement,
	key: string,
): void {
	const tabs = [...strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
	const currentIndex = tabs.indexOf(current);
	if (currentIndex < 0 || tabs.length === 0) return;
	let nextIndex = currentIndex;
	if (key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
	if (key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
	if (key === 'Home') nextIndex = 0;
	if (key === 'End') nextIndex = tabs.length - 1;
	tabs[nextIndex]?.focus();
}

export function renderSavedViewTabs(
	container: HTMLElement,
	catalog: SavedViewCatalog,
	activeViewId: string | undefined,
	idPrefix: string,
	actions: SavedViewTabActions,
): void {
	const navigation = container.createDiv({ cls: 'cv-view-navigation' });
	const viewList = navigation.createDiv({ cls: 'cv-view-list' });
	const strip = viewList.createDiv({ cls: 'cv-view-tab-strip' });
	strip.setAttribute('role', 'tablist');
	strip.setAttribute('aria-label', 'Saved views');
	const models = savedViewTabModels(catalog);
	const fallbackTabStop = models[0]?.id;
	let activeTabItem: HTMLElement | undefined;

	for (const model of models) {
		const wrapper = strip.createDiv({ cls: 'cv-view-tab-item' });
		wrapper.setAttribute('role', 'presentation');
		const selected = model.definition !== undefined && model.id === activeViewId;
		const attributes: Record<string, string> = {
			type: 'button',
			role: 'tab',
			'aria-selected': String(selected),
		};
		if (model.definition) {
			attributes['aria-controls'] = savedViewPanelId(idPrefix, model.id);
			if (catalog.canMutate) {
				attributes['aria-haspopup'] = 'menu';
				attributes['aria-keyshortcuts'] = 'Shift+F10';
			}
		}
		const tab = wrapper.createEl('button', {
			cls: 'cv-view-tab',
			attr: attributes,
		});
		tab.dataset.viewId = model.id;
		tab.tabIndex = selected || (!activeViewId && model.id === fallbackTabStop) ? 0 : -1;
		if (selected) {
			tab.addClass('is-active');
			activeTabItem = wrapper;
		}
		if (!model.definition) {
			tab.addClass('is-unavailable');
			tab.setAttribute('aria-disabled', 'true');
			tab.setAttribute('title', model.unavailableReason ?? 'Unavailable view');
		}
		const icon = tab.createSpan({ cls: 'cv-view-tab-icon' });
		setIcon(icon, viewIcon(model.type));
		tab.createSpan({ cls: 'cv-view-tab-name', text: model.name });

		tab.addEventListener('click', () => {
			if (model.definition) actions.onActivate(model.definition);
		});
		tab.addEventListener('contextmenu', (event) => {
			if (!model.definition || !catalog.canMutate) return;
			event.preventDefault();
			event.stopPropagation();
			showViewMenu(model.definition, catalog, actions, tab, event);
		});
		tab.addEventListener('keydown', (event) => {
			if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
				event.preventDefault();
				focusRelativeTab(strip, tab, event.key);
				return;
			}
			if ((event.key === 'Enter' || event.key === ' ') && model.definition) {
				event.preventDefault();
				actions.onActivate(model.definition);
				return;
			}
			if (
				(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) &&
				model.definition &&
				catalog.canMutate
			) {
				event.preventDefault();
				showViewMenu(model.definition, catalog, actions, tab);
			}
		});

	}

	const add = viewList.createEl('button', {
		cls: 'cv-add-view',
		attr: { type: 'button', 'aria-label': 'Add a new view' },
	});
	setIcon(add, 'plus');
	add.disabled = !catalog.canMutate;
	setTooltip(
		add,
		catalog.canMutate
			? 'Add a new view'
			: 'Repair the saved-view configuration before adding a view.',
		{ placement: 'top' },
	);
	add.addEventListener('click', () => actions.onAdd());

	if (activeTabItem) {
		activeTabItem.ownerDocument.defaultView?.requestAnimationFrame(() => {
			if (!activeTabItem) return;
			const stripBounds = strip.getBoundingClientRect();
			const itemBounds = activeTabItem.getBoundingClientRect();
			if (itemBounds.left < stripBounds.left) {
				strip.scrollLeft -= stripBounds.left - itemBounds.left;
			} else if (itemBounds.right > stripBounds.right) {
				strip.scrollLeft += itemBounds.right - stripBounds.right;
			}
		});
	}
}
