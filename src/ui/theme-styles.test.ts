import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync('styles.css', 'utf8');
const styleRules = styles.replace(/\/\*[\s\S]*?\*\//g, '');

function declarationsFor(selector: string): string {
	return Array.from(styleRules.matchAll(/([^{}]+)\{([^{}]*)\}/g))
		.filter((match) =>
			(match[1] ?? '')
				.split(',')
				.some((ruleSelector) => ruleSelector.trim() === selector),
		)
		.map((match) => match[2] ?? '')
		.join('\n');
}

describe('calendar theme styles', () => {
	it('uses a dark surface for event color tokens in dark mode', () => {
		const declarations = declarationsFor('.theme-dark .cv-color-token');

		expect(declarations).toContain('--cv-color-bg:');
		expect(declarations).toContain('--cv-color-chip-bg:');
		expect(declarations).toContain('var(--background-primary)');
		expect(declarations).toContain('--cv-color-text: var(--text-normal)');
	});

	it('keeps calendar event cards on their positioned track layout', () => {
		const declarations = declarationsFor('.cv-event-card');

		expect(declarations).toContain('height: var(--cv-card-height)');
		expect(declarations).toContain('left: calc(');
		expect(declarations).toContain('position: absolute');
		expect(declarations).toContain('top: calc(');
		expect(declarations).toContain('width: calc(');
	});

	it('keeps an icon-only Add view beside the scrollable tabs and reveals it on intent', () => {
		const navigation = declarationsFor('.cv-view-navigation');
		const viewList = declarationsFor('.cv-view-list');
		const strip = declarationsFor('.cv-view-tab-strip');
		const add = declarationsFor('.cv-add-view');
		const hoverAdd = declarationsFor('.cv-view-list:hover .cv-add-view');
		const focusAdd = declarationsFor('.cv-view-list:focus-within .cv-add-view');

		expect(navigation).toContain('overflow: hidden');
		expect(viewList).toContain('flex: 0 1 auto');
		expect(viewList).toContain('max-width: 100%');
		expect(viewList).toContain('min-width: 0');
		expect(strip).toContain('overflow-x: auto');
		expect(strip).toContain('flex: 0 1 auto');
		expect(strip).toContain('gap: 6px');
		expect(add).toContain('border-radius: 50%');
		expect(add).toContain('flex: 0 0 30px');
		expect(add).toContain('opacity: 0');
		expect(add).toContain('pointer-events: none');
		expect(add).toContain('width: 30px');
		expect(hoverAdd).toContain('opacity: 1');
		expect(hoverAdd).toContain('pointer-events: auto');
		expect(focusAdd).toContain('opacity: 1');
		expect(focusAdd).toContain('pointer-events: auto');
	});

	it('shrinks long calendar identities before navigation and toolbar actions', () => {
		const toolbar = declarationsFor('.cv-view-toolbar');
		const identity = declarationsFor('.cv-calendar-identity');
		const name = declarationsFor('.cv-calendar-name');
		const navigation = declarationsFor('.cv-view-navigation');
		const actions = declarationsFor('.cv-toolbar-actions');

		expect(toolbar).toContain('min-width: 0');
		expect(identity).toContain('flex: 0 1 auto');
		expect(identity).toContain('min-width: 0');
		expect(name).toContain('min-width: 0');
		expect(name).toContain('overflow: hidden');
		expect(name).toContain('text-overflow: ellipsis');
		expect(name).toContain('white-space: nowrap');
		expect(navigation).toContain('flex: 1 1 80px');
		expect(actions).toContain('flex: 0 0 auto');
	});

	it('resets board cards to ordinary document flow', () => {
		const declarations = declarationsFor('.cv-board-card.cv-event-card');

		expect(declarations).toContain('height: auto');
		expect(declarations).toContain('left: auto');
		expect(declarations).toContain('position: static');
		expect(declarations).toContain('top: auto');
		expect(declarations).toContain('width: 100%');
	});

	it('shrinks board columns before falling back to horizontal scrolling', () => {
		const surface = declarationsFor('.cv-board-surface');
		const columns = declarationsFor('.cv-board-columns');
		const column = declarationsFor('.cv-board-column');

		expect(surface).toContain('--cv-board-column-min-width: 200px');
		expect(surface).toContain('--cv-board-column-width: 260px');
		expect(surface).toContain('overflow-x: auto');
		expect(columns).toContain('display: flex');
		expect(columns).toContain('width: 100%');
		expect(column).toContain('flex: 0 1 var(--cv-board-column-width)');
		expect(column).toContain('min-width: var(--cv-board-column-min-width)');
		expect(column).toContain('width: var(--cv-board-column-width)');
		expect(column).toContain('min-height: 160px');
		expect(column).toContain('var(--background-secondary)');
		expect(column).toContain('var(--background-modifier-border)');
	});

	it('keeps pending, drop, setup, and error states visibly distinct', () => {
		expect(declarationsFor('.cv-board-card.is-pending')).toContain(
			'cursor: progress',
		);
		expect(declarationsFor('.cv-board-column.is-drag-target')).toContain(
			'border-color:',
		);
		expect(declarationsFor('.cv-board-setup')).toContain(
			'border: 1px solid var(--background-modifier-border)',
		);
		expect(declarationsFor('.cv-board-error')).toContain(
			'border-color: var(--background-modifier-error)',
		);
	});
});
