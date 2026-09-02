import { describe, expect, it, vi } from 'vitest';
import { EVENT_PARENT_ITEM_PROPERTY } from '../domain/reserved-properties';
import { renderEventPropertyInput } from './event-property-input';

interface ElementOptions {
	attr?: Record<string, string>;
	text?: string;
	type?: string;
	value?: string;
}

class MockElement {
	readonly attributes = new Map<string, string>();
	readonly children: MockElement[] = [];
	readonly classes = new Set<string>();
	readonly listeners = new Map<string, () => void>();
	placeholder = '';
	text = '';
	value = '';

	constructor(
		readonly tag = 'div',
		options?: ElementOptions,
	) {
		this.text = options?.text ?? '';
		this.value = options?.value ?? '';
		for (const [name, value] of Object.entries(options?.attr ?? {})) {
			this.attributes.set(name, value);
		}
	}

	addClass(className: string): void {
		this.classes.add(className);
	}

	addEventListener(event: string, listener: () => void): void {
		this.listeners.set(event, listener);
	}

	createEl(tag: string, options?: ElementOptions): MockElement {
		const child = new MockElement(tag, options);
		this.children.push(child);
		return child;
	}

	emit(event: string): void {
		this.listeners.get(event)?.();
	}

	setAttribute(name: string, value: string): void {
		this.attributes.set(name, value);
	}
}

describe('fixed relation property input', () => {
	it('shows parent titles while retaining path-safe wikilink values', () => {
		const container = new MockElement();
		const onChange = vi.fn();

		renderEventPropertyInput(
			container as unknown as HTMLElement,
			EVENT_PARENT_ITEM_PROPERTY,
			undefined,
			'[[Life/Work/generated--78gG]]',
			onChange,
			[
				{ path: 'Life/Work/generated--78gG.md', title: '任务四' },
				{ path: 'Life/Work/hello--d850.md', title: 'hello' },
			],
		);

		const select = container.children[0];
		expect(select).toMatchObject({
			tag: 'select',
			value: '[[Life/Work/generated--78gG]]',
		});
		expect(select?.classes).toEqual(
			new Set(['dropdown', 'cv-event-parent-item-select']),
		);
		expect(select?.attributes.get('aria-label')).toBe('Parent item');
		expect(select?.children[0]).toMatchObject({ value: '', text: 'None' });

		const parentOptions = select?.children.slice(1) ?? [];
		expect(parentOptions.map((option) => option.text)).toEqual(
			expect.arrayContaining(['任务四', 'hello']),
		);
		expect(parentOptions.map((option) => option.value)).toEqual(
			expect.arrayContaining([
				'[[Life/Work/generated--78gG]]',
				'[[Life/Work/hello--d850]]',
			]),
		);
		for (const option of parentOptions) {
			expect(option.text).not.toMatch(/Life\/Work|\.md|--[\w-]+/u);
		}

		if (!select) throw new Error('Expected parent item select');
		select.value = '[[Life/Work/hello--d850]]';
		select.emit('change');
		expect(onChange).toHaveBeenLastCalledWith('[[Life/Work/hello--d850]]');

		select.value = '';
		select.emit('change');
		expect(onChange).toHaveBeenLastCalledWith(undefined);
	});

	it('keeps duplicate titles tied to their distinct item paths', () => {
		const container = new MockElement();
		const onChange = vi.fn();

		renderEventPropertyInput(
			container as unknown as HTMLElement,
			EVENT_PARENT_ITEM_PROPERTY,
			undefined,
			undefined,
			onChange,
			[
				{ path: 'Tasks/First--1111.md', title: 'Same title' },
				{ path: 'Tasks/Second--2222.md', title: 'Same title' },
			],
		);

		const select = container.children[0];
		const parentOptions = select?.children.slice(1) ?? [];
		expect(parentOptions.map((option) => option.text)).toEqual([
			'Same title',
			'Same title',
		]);
		expect(parentOptions.map((option) => option.value)).toEqual([
			'[[Tasks/First--1111]]',
			'[[Tasks/Second--2222]]',
		]);

		if (!select) throw new Error('Expected parent item select');
		select.value = '[[Tasks/Second--2222]]';
		select.emit('change');
		expect(onChange).toHaveBeenCalledWith('[[Tasks/Second--2222]]');
	});

	it('preserves a current parent value that is not among the candidates', () => {
		const container = new MockElement();
		const onChange = vi.fn();

		renderEventPropertyInput(
			container as unknown as HTMLElement,
			EVENT_PARENT_ITEM_PROPERTY,
			undefined,
			'[[Archive/Parent--old|Parent]]',
			onChange,
			[],
		);

		const select = container.children[0];
		expect(select).toMatchObject({
			value: '[[Archive/Parent--old|Parent]]',
		});
		expect(select?.children.map((option) => [option.value, option.text])).toEqual([
			['', 'None'],
			['[[Archive/Parent--old|Parent]]', 'Current parent item'],
		]);
	});
});
