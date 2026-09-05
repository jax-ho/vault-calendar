import {
	isWritableBoardGroupProperty,
	validSavedViews,
} from './saved-views';
import type {
	CalendarConfig,
	SavedViewCatalog,
	SavedViewType,
	ViewId,
	WeekStartsOn,
} from '../types';

function catalogNames(catalog: SavedViewCatalog): Set<string> {
	return new Set(
		catalog.entries
			.map((entry) =>
				entry.kind === 'valid' ? entry.definition.name : entry.name,
			)
			.filter((name): name is string => Boolean(name))
			.map((name) => name.trim().toLocaleLowerCase()),
	);
}

export function suggestSavedViewName(
	catalog: SavedViewCatalog,
	type: SavedViewType,
): string {
	const base = type === 'calendar' ? 'Calendar view' : 'Board';
	const names = catalogNames(catalog);
	if (!names.has(base.toLocaleLowerCase())) return base;
	for (let suffix = 2; ; suffix += 1) {
		const candidate = `${base} ${suffix}`;
		if (!names.has(candidate.toLocaleLowerCase())) return candidate;
	}
}

export function writableBoardGroupProperties(config: CalendarConfig): string[] {
	return Object.keys(config.propertyDefinitions)
		.filter((property) => isWritableBoardGroupProperty(config, property))
		.sort((left, right) => left.localeCompare(right));
}

export function preferredBoardGroupProperty(config: CalendarConfig): string | undefined {
	const properties = writableBoardGroupProperties(config);
	return properties.find((property) => property === 'status') ?? properties[0];
}

export function preferredCalendarWeekStart(
	catalog: SavedViewCatalog,
	activeViewId?: ViewId,
): WeekStartsOn {
	const calendars = validSavedViews(catalog).filter(
		(view) => view.type === 'calendar',
	);
	const active = calendars.find((view) => view.id === activeViewId);
	return active?.type === 'calendar'
		? active.weekStartsOn
		: calendars[0]?.type === 'calendar'
			? calendars[0].weekStartsOn
			: 'locale';
}
