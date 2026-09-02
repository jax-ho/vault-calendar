# Vault Calendar

Turn Markdown notes into a visual calendar without moving your data out of Obsidian.

Vault Calendar gives each event a familiar calendar card while keeping the source of truth in ordinary Markdown files. You can create and edit events from the calendar, organize them with properties, and schedule work across a single day or a date range.

## What you can do

- Create multiple independent calendars inside one vault.
- View events by month or by week.
- Create events with a title, properties, and Markdown notes.
- Organize tasks with one parent item and any number of derived sub-items.
- Edit an event in a focused popup with automatic saving.
- Drag cards to move events to another date.
- Resize cards to change their start and end dates.
- Add Select, Checkbox, Text, and Number properties.
- Give Select options their own colors and use one Select property to color cards.
- Show existing Markdown notes when they contain the calendar's date property.
- Keep everything local and readable in your vault.

## Requirements

- Obsidian 1.13.7 or later.
- Desktop Obsidian. Mobile and touch interactions are not supported yet.

## Installation

### Community Plugins

1. Open **Settings → Community plugins**.
2. Select **Browse** and search for **Vault Calendar**.
3. Select **Install**, then **Enable**.

If Vault Calendar does not appear in the Community Plugins browser yet, use the manual installation method below.

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/jax-ho/vault-calendar/releases/latest).
2. In your vault, create `.obsidian/plugins/vault-calendar/`.
3. Place the three downloaded files in that folder.
4. Reload Obsidian.
5. Open **Settings → Community plugins** and enable **Vault Calendar**.

Community plugins are installed separately for each vault.

## Create your first calendar

1. Open the Command palette.
2. Run **Vault Calendar: Create calendar document**.
3. Enter a calendar name.
4. Choose where in your vault the calendar should live.
5. Select **Create**.

Vault Calendar creates a dedicated folder for the calendar and opens it immediately. The folder contains:

- `_calendar.md`, which stores the calendar's settings.
- The Markdown notes that appear as events.

The resulting structure is:

```text
<chosen location>/
└── <calendar name>/
    ├── _calendar.md
    └── event notes…
```

You do not need to create or edit `_calendar.md` manually.

New calendars start with two properties:

- `status`: Not started, Blocked, In progress, Abandoned, or Done.
- `type`: Task, Learn, or Idea.

You can change or remove these options and add your own properties later.

## Open a calendar

Use whichever method is most convenient:

- Select the calendar icon in the left ribbon. It opens your most recent calendar or lets you choose one.
- Run **Vault Calendar: Open calendar document** from the Command palette.
- Right-click a `_calendar.md` file and select **Open as calendar**.
- Open `_calendar.md`, then run **Vault Calendar: Open active file as calendar**.

The document icon beside the calendar name opens the underlying `_calendar.md` source note.

## Add an event

Move your pointer over a day and select the **+** button in its upper-left corner. You can also select **New** in the calendar toolbar to create an event on the currently focused date.

Before creating the event, you can enter:

- A title.
- Values for the calendar's configured properties.
- Markdown notes.

Select **Create** when you are ready. The popup closes, the calendar stays open, and the new event appears immediately.

Each event is saved as a separate Markdown note in the calendar folder. Vault Calendar adds a short unique suffix to the filename, so two events can use the same title without overwriting each other. The title displayed on the card comes from the note's `title` property, not from that suffix.

## Edit an event

Select an event card to open its editor. You can change:

- Title.
- Start date.
- End date.
- Parent item.
- Custom properties.
- Markdown notes.

`parent-item` and `sub-items` are fixed relationship fields. Choose a parent item
with an Obsidian wikilink; Vault Calendar derives the parent's sub-items from
those links and shows the relationship on both cards. `sub-items` is read-only
and is not duplicated into note frontmatter.

Changes save automatically. The editor shows **Saving…**, **Saved**, or **Not saved** so you always know the current state.

Select **Open note** when you want the full Obsidian Markdown editor.

## Move and resize events

- Drag an event card to another day to move the complete event.
- Drag the left or right edge of a card to change its start or end date.
- Multi-day events continue across week boundaries automatically.

Range resizing is available when the calendar has an end-date property configured. You can change or disable that property under **Calendar settings → Event fields**.

## Customize a calendar

Select the settings icon in the calendar toolbar. Settings save automatically and are specific to the current calendar.

### Calendar

- Rename the calendar.
- Include or ignore notes in subfolders.
- Exclude particular files or folders.

### Event fields

- Choose which Markdown property supplies the start date.
- Choose the optional end-date property.

The defaults are `date` and `date-end`.

### Properties

Properties define the fields available when you create or edit an event.

Supported property types:

- **Select**: a list of colored options.
- **Checkbox**: a checked or unchecked value.
- **Text**: a free-form text value.
- **Number**: a numeric value.

For every property, you can:

- Set a default value for new events.
- Show or hide it on event cards.
- Change its position on cards.
- Rename, edit, or delete it.

For Select properties, you can also:

- Add, rename, reorder, and delete options.
- Assign a color to each option.
- Choose the default option.

Every Select property includes `None` as its required empty option. If an event contains an option that is no longer configured, the calendar safely treats it as `None`.

The **Card color** setting links the event card background to one Select property. For example, linking card color to `status` lets Done, Blocked, and In progress events use their configured colors.

Renaming a property through Calendar settings updates that property name in the calendar schema and in existing event notes. Deleting a property from the calendar does not remove the old value from existing notes.

### View

- Start the week on Monday or Sunday.
- Use Month or Week layout.
- Open full notes in the current leaf or in a new tab.

You can also switch between Month and Week directly from the calendar toolbar.

## Use existing Markdown notes

Vault Calendar automatically includes Markdown notes inside the calendar folder when they contain a valid start-date property.

With the default event fields, a note can look like this:

```markdown
---
title: Prepare launch
date: 2026-09-04
date-end: 2026-09-06
status: In progress
type: Task
parent-item: "[[Projects/Launch/Quarterly roadmap]]"
---

Review the checklist and prepare the announcement.
```

The recommended date format is `YYYY-MM-DD`. ISO 8601 date-time values are also accepted, but Vault Calendar currently displays events as all-day cards.

The `title`, `parent-item`, and `sub-items` properties are reserved. `title`
controls the event title, `parent-item` stores one wikilink, and `sub-items` is
derived by Vault Calendar. Other property names come from the calendar's
Properties settings.

You can edit event notes directly in Obsidian. Vault Calendar refreshes when a note is created, edited, renamed, or deleted.

## Multiple calendars

Run **Vault Calendar: Create calendar document** again whenever you need another calendar. Each calendar has its own:

- Folder and event notes.
- Date fields.
- Property definitions and Select options.
- Card colors.
- View settings.

This keeps unrelated calendars independent while allowing all of them to remain normal parts of the same vault.

## Troubleshooting

### My note does not appear

Check that:

- The note is inside the calendar folder.
- **Include subfolders** is enabled if the note is in a nested folder.
- The note is not covered by **Excluded paths**.
- The configured start-date property exists and contains a valid date.

The calendar toolbar shows an **unscheduled** button when it finds notes with missing or invalid date information.

### I only see `_calendar.md` as a Markdown file

Open it through the ribbon icon, **Open calendar document**, or **Open as calendar**. A normal click in the file explorer may open the underlying source note instead.

### Can I edit `_calendar.md` myself?

Yes, but Calendar settings is the safer interface. Manual changes are read literally. For example, manually changing a property name is treated as deleting the old property and adding a new one; Vault Calendar does not guess that it was a rename.

### What happens if I delete `_calendar.md`?

The calendar view is removed, but the other Markdown notes in its folder are not deleted.

### Does Vault Calendar sync my events?

Vault Calendar does not provide its own sync service. Your notes can still sync through Obsidian Sync, iCloud, Git, or any other method you already use for the vault.

## Current limitations

- Month and Week views are all-day layouts; there is no hourly schedule.
- Search, filtering, recurring events, reminders, and configurable sorting are not available yet.
- Google Calendar, Apple Calendar, and other external calendar services are not supported.
- Mobile and touch-specific interactions are not supported.

## Privacy and data ownership

Vault Calendar runs locally. It does not use telemetry, cloud storage, or network requests, and it never uploads your note contents, filenames, or properties.

Your calendar definitions and events remain Markdown files that you can read, edit, move, back up, and version with normal Obsidian tools.

## Support

If something is not working as expected, [open an issue](https://github.com/jax-ho/vault-calendar/issues) and include:

- Your Obsidian version.
- Your operating system.
- The steps needed to reproduce the problem.
- A screenshot or error message, with private note content removed.

Vault Calendar is released under the [0BSD license](https://github.com/jax-ho/vault-calendar/blob/main/LICENSE).
