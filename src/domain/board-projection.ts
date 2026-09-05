import type {
	BoardSavedView,
	CalendarItem,
	CalendarPropertyDefinition,
} from '../types';
import { compareCalendarItems } from './projection';
import {
	resolvedSelectValue,
	SELECT_NONE_VALUE,
	selectPropertyOptions,
} from './property-values';

export interface BoardColumn {
	value: string;
	items: CalendarItem[];
}

export function projectBoardColumns(
	items: readonly CalendarItem[],
	view: BoardSavedView,
	definition: CalendarPropertyDefinition,
): BoardColumn[] {
	if (!view.groupBy) throw new Error('Board view does not have a group property.');
	if (definition.type !== 'select') {
		throw new Error(`Board group property must be a Select property: ${view.groupBy}`);
	}

	const columns = selectPropertyOptions(definition).map((value) => ({
		value,
		items: [] as CalendarItem[],
	}));
	const columnsByValue = new Map(columns.map((column) => [column.value, column]));
	const noneColumn = columnsByValue.get(SELECT_NONE_VALUE);
	if (!noneColumn) throw new Error('Board projection requires a None column.');

	for (const item of items) {
		const effectiveValue = resolvedSelectValue(
			definition,
			item.properties[view.groupBy],
		);
		(columnsByValue.get(effectiveValue) ?? noneColumn).items.push(item);
	}

	return columns.map((column) => ({
		...column,
		items: [...column.items].sort(compareCalendarItems),
	}));
}
