export interface CalendarCardMetrics {
	height: number;
	step: number;
}

const MINIMUM_CARD_HEIGHT = 108;
const CARD_VERTICAL_PADDING_AND_TITLE = 40;
const PROPERTY_ROW_STEP = 22;
const CARD_GAP = 6;

export function calendarCardMetrics(
	visiblePropertyCount: number,
	relationshipRowCount = 0,
): CalendarCardMetrics {
	const propertyCount = Math.max(0, Math.floor(visiblePropertyCount));
	const relationCount = Math.max(0, Math.floor(relationshipRowCount));
	const rowCount = propertyCount + relationCount;
	const height = Math.max(
		MINIMUM_CARD_HEIGHT,
		CARD_VERTICAL_PADDING_AND_TITLE + rowCount * PROPERTY_ROW_STEP,
	);
	return { height, step: height + CARD_GAP };
}
