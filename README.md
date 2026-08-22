# Calendar View for Obsidian

Calendar View is a local-first desktop plugin that projects ordinary Markdown notes onto a compact month or week calendar. Calendar definitions and events remain readable Markdown; the plugin does not use a private database, telemetry, cloud synchronization, or network requests.

Version `0.1.0` is a P0 implementation intended for local testing. It is not yet submitted to the Obsidian community plugin catalog.

## What works

- Multiple named calendars, each defined by a dedicated `<root>/<calendar>/_calendar.md` document.
- Recursive or direct-child event indexing inside each calendar's own folder, with excluded paths.
- Reserved `title`, configurable start date, optional end date, visible properties, week start, layout, and open behavior.
- Month and all-day week layouts with full weeks, adjacent-month days, today/focus states, navigation, and stable ordering.
- Multi-day bars split across week boundaries, with calendar rows expanding to show every event card.
- Native note opening, safe note creation, whole-range dragging, and start/end resizing.
- `mtime` conflict detection and atomic `FileManager.processFrontMatter` updates that touch only mapped date fields.
- Incremental create, modify, rename, and delete handling through Vault and Metadata Cache events.
- Per-calendar and per-leaf focus/scroll state, including migration on calendar-document rename and cleanup on deletion.
- Light/Dark theme support through Obsidian CSS variables.

## Calendar documents

A calendar is a dedicated `_calendar.md` note inside its event folder. For example, choosing `Life` as the root and `Work` as the calendar name creates `Life/Work/_calendar.md`; all Work events also live under `Life/Work/`.

`Life/Work/_calendar.md`:

```yaml
---
title: Work calendar
calendar-view: true
calendar-recursive: true
calendar-start-property: date
calendar-end-property: date-end
calendar-visible-properties:
  - status
  - type
calendar-properties:
  status:
    type: select
    options:
      - None
      - Not started
      - In progress
      - Done
    colors:
      None: default
      Not started: gray
      In progress: blue
      Done: green
    default: Not started
  type:
    type: select
    options:
      - None
      - Task
      - Learn
      - Idea
    colors:
      None: default
      Task: blue
      Learn: green
      Idea: purple
    default: Task
calendar-card-color-property: status
calendar-week-starts-on: monday
calendar-layout: month
calendar-open-behavior: same-leaf
calendar-exclude-paths:
  - Life/Work/Archive
---
```

The calendar name uses `_calendar.md`'s `title`, then falls back to the folder name. Event notes always use the reserved `title` frontmatter property for their title; it cannot be remapped or added as a custom property. The event source and creation folder are always the folder containing `_calendar.md`; they are not separate configuration values. `calendar-week-starts-on` accepts `locale`, `monday`, or `sunday`. An omitted `calendar-end-property` uses the default `date-end`; set it to an empty string to disable date-range resizing.

`calendar-properties` is the per-calendar editor schema. Supported types are `text`, `number`, `checkbox`, and `select`; select fields store their choices in `options`, and `None` is always normalized as their first real option. Select `colors` use the Notion-style palette `default`, `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, or `red`. Every type accepts an optional, type-checked `default`, and select defaults must match one of their options. Set `calendar-card-color-property` to a Select property such as `status` to color each event card from its current option. Schema fields automatically appear in the event editor, while `calendar-visible-properties` independently controls which fields appear on calendar cards. New event notes store configured defaults together with their property values.

Every nested `_calendar.md` file is excluded from event indexes, even if its configuration is incomplete. Other filenames are ordinary notes even if they contain old `calendar-*` properties. A calendar's identity is its canonical `_calendar.md` path.

## Event date format

The mapped start date is required for a note to appear. Accepted values are:

- A plain date such as `2026-08-17`.
- An ISO 8601 date-time such as `2026-08-17T09:30:00+08:00`.
- An equivalent YAML date value returned by Obsidian Properties.

The authored calendar date portion of an ISO date-time is used for the all-day card. Invalid dates and end dates earlier than start dates are isolated and listed through the toolbar warning; they are never silently corrected. Event identity is the full note path, so same-title notes remain separate.

## Build and test

Node.js 20.19 or newer and npm are required.

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run build
# Or run the complete local check:
npm run check
```

The production build creates `main.js` at the repository root. Automated tests cover configuration defaults and validation, source exclusions, date parsing, month/week grids, event projection, range segmentation, drag/resize calculations, stable sorting, state isolation and document lifecycle, duplicate creation refusal, conflict detection, and targeted frontmatter mutation.

## Manual installation

1. Run `npm install && npm run build`.
2. Create `<Vault>/.obsidian/plugins/obsidian-calendar-view/` in a test vault.
3. Copy `main.js`, `manifest.json`, and `styles.css` into that directory.
4. Reload Obsidian, then enable **Calendar View** under **Settings → Community plugins**.
5. Run **Calendar View: Create calendar document**. Only nested `_calendar.md` definitions can be opened as calendars.

The public Obsidian API does not provide a safe way for this plugin to transparently replace only selected Markdown views. Calendar documents therefore remain normal Markdown in Source/Reading View and use a path-backed custom `ItemView` when opened through **Open calendar document**, **Open active file as calendar**, the ribbon button, or **Open as calendar** in the file menu. The source-note button in the calendar toolbar opens the underlying Markdown definition.

## Fixture vault and smoke test

`fixtures/test-vault` contains a calendar, single-day sample, multi-day sample, same-title notes, and an invalid-date note. It is deliberately separate from any real vault.

Use this checklist in a controllable Obsidian environment:

1. Install the build artifacts into the fixture vault only.
2. Open `Projects/WonderShare Work/_calendar.md` as a calendar and navigate to August 2026.
3. Confirm `入职` appears on August 17 with `status` and `type`.
4. Click it, then drag it to August 18 and verify only `date` changed.
5. Resize `发布准备` from August 20 through August 22, then collapse it to one day and verify `date-end` is removed.
6. Open a second calendar leaf, navigate independently, then rename the calendar document and reload Obsidian.
7. Test default Light and Dark themes and at least one community theme.
8. Begin dragging a note, modify it externally, then drop and confirm the plugin refuses the stale write.

## Known P0 limits

- Search, filter, configurable multi-level sorting, continuous month scrolling, and comprehensive keyboard card navigation remain later work. Default ordering is deterministic: start date, title, then path.
- Week view is an all-day seven-column layout, not an hourly schedule.
- Mobile and touch-specific behavior are outside this desktop P0.
- Note templates, recurring events, reminders, third-party calendar synchronization, and Obsidian Bases are not implemented.
- Visual acceptance must still be performed inside Obsidian; automated DOM-free tests do not claim theme or drag-and-drop smoke-test coverage.

## Privacy and safety

Calendar View runs locally. It reads Markdown metadata within each calendar folder and never uploads note contents, filenames, or properties. All event date changes use Obsidian's public frontmatter API. Deleting `_calendar.md` only closes its calendar view and removes plugin UI state; it never deletes event notes.
