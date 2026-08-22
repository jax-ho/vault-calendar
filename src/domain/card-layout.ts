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
): CalendarCardMetrics {
	const count = Math.max(0, Math.floor(visiblePropertyCount));
	const height = Math.max(
		MINIMUM_CARD_HEIGHT,
		CARD_VERTICAL_PADDING_AND_TITLE + count * PROPERTY_ROW_STEP,
	);
	return { height, step: height + CARD_GAP };
}
