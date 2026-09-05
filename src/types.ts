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

export type ViewId = string;

export type SavedViewType = 'calendar' | 'board';

export interface SavedViewBase {
	id: ViewId;
	name: string;
}

export interface CalendarSavedView extends SavedViewBase {
	type: 'calendar';
	layout: CalendarLayout;
	weekStartsOn: WeekStartsOn;
}

export interface BoardSavedView extends SavedViewBase {
	type: 'board';
	groupBy?: string;
}

export type SavedView = CalendarSavedView | BoardSavedView;

export interface ViewConfigIssue extends ConfigIssue {
	viewId?: ViewId;
}

export type SavedViewCatalogEntry =
	| {
			kind: 'valid';
			definition: SavedView;
			warnings?: ViewConfigIssue[];
	  }
	| {
			kind: 'invalid';
			id?: string;
			name?: string;
			raw: unknown;
			issues: ViewConfigIssue[];
	  }
	| {
			kind: 'unsupported';
			id?: string;
			name?: string;
			viewType?: string;
			raw: unknown;
	  };

export interface SavedViewCatalog {
	source: 'legacy' | 'canonical';
	entries: SavedViewCatalogEntry[];
	canMutate: boolean;
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
	/**
	 * Parsed and newly-created configs always provide this catalog. It remains optional
	 * temporarily so callers can migrate from the pre-saved-view CalendarConfig shape.
	 */
	viewCatalog?: SavedViewCatalog;
	/** Transitional facade; saved-view-aware callers read CalendarSavedView.weekStartsOn. */
	weekStartsOn: WeekStartsOn;
	/** Transitional facade; saved-view-aware callers read CalendarSavedView.layout. */
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

export type SavedViewUiState =
	| {
			type: 'calendar';
			focusDate: string;
			scrollTop?: number;
	  }
	| {
			type: 'board';
			scrollLeft?: number;
			scrollTop?: number;
	  };

export interface CalendarUiState {
	activeViewId?: ViewId;
	viewStates: Record<ViewId, SavedViewUiState>;
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
