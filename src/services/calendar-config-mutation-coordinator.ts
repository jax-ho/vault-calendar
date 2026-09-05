export class CalendarConfigMutationCoordinator {
	private readonly tails = new Map<string, Promise<void>>();

	run<T>(documentPath: string, mutate: () => Promise<T>): Promise<T> {
		const previous = this.tails.get(documentPath) ?? Promise.resolve();
		const result = previous.then(mutate, mutate);
		const tail = result.then(
			() => undefined,
			() => undefined,
		);
		this.tails.set(documentPath, tail);
		void tail.finally(() => {
			if (this.tails.get(documentPath) === tail) this.tails.delete(documentPath);
		});
		return result;
	}
}
