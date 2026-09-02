export type CalendarLayout = 'month' | 'week';

export type WeekStartsOn = 'locale' | 'monday' | 'sunday';

export type OpenBehavior = 'same-leaf' | 'new-tab';

export type CalendarPropertyType = 'text' | 'select' | 'checkbox' | 'number';

export type CalendarColor =
	| 'default'
	| 'gray'
	| 'brown'
	| 'orange'
	| 'yellow'
	| 'green'
	| 'blue'
	| 'purple'
	| 'pink'
	| 'red';

export interface CalendarPropertyDefinition {
	type: CalendarPropertyType;
	options?: string[];
	colors?: Record<string, CalendarColor>;
	default?: string | number | boolean;
}

export interface CalendarConfig {
	documentPath: string;
	name: string;
	sourceFolder: string;
	recursive: boolean;
	startDateProperty: string;
	endDateProperty?: string;
	visibleProperties: string[];
	propertyDefinitions: Record<string, CalendarPropertyDefinition>;
	cardColorProperty?: string;
	weekStartsOn: WeekStartsOn;
	layout: CalendarLayout;
	openBehavior: OpenBehavior;
	createFolder: string;
	excludePaths: string[];
}

export interface ConfigIssue {
	field: string;
	message: string;
}

export interface CalendarConfigResult {
	isCalendarDocument: boolean;
	config?: CalendarConfig;
	issues: ConfigIssue[];
}

export interface CalendarItemReference {
	path: string;
	title: string;
}

export interface CalendarItem {
	path: string;
	title: string;
	start: string;
	startTimeSort: number;
	end?: string;
	allDay: boolean;
	properties: Record<string, unknown>;
	color?: CalendarColor;
	mtime: number;
	parentItem?: CalendarItemReference;
	subItems: CalendarItemReference[];
}

export type ProjectionIssueKind =
	| 'missing-date'
	| 'invalid-start'
	| 'invalid-end'
	| 'end-before-start'
	| 'metadata-unavailable'
	| 'invalid-parent-item'
	| 'parse-error';

export interface ProjectionIssue {
	path: string;
	kind: ProjectionIssueKind;
	message: string;
}

export interface CalendarIndexSnapshot {
	items: CalendarItem[];
	issues: ProjectionIssue[];
	indexedCount: number;
}

export interface CalendarUiState {
	focusDate: string;
	layout?: CalendarLayout;
	scrollTop?: number;
}

export interface CalendarDocumentState {
	shared?: CalendarUiState;
	leaves: Record<string, CalendarUiState>;
}

export interface CalendarPluginData {
	calendarStates: Record<string, CalendarDocumentState>;
	recentCalendarPath?: string;
}

export interface CalendarViewState {
	calendarDocumentPath?: string;
	instanceId?: string;
}
