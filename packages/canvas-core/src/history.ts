export class HistoryStack<T> {
  readonly #limit: number;
  #past: T[] = [];
  #present: T;
  #future: T[] = [];

  constructor(initial: T, limit = 50) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('history limit must be a positive integer');
    this.#limit = limit;
    this.#present = clone(initial);
  }

  get current(): T {
    return clone(this.#present);
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  push(value: T): T {
    this.#past.push(clone(this.#present));
    if (this.#past.length > this.#limit) this.#past.shift();
    this.#present = clone(value);
    this.#future = [];
    return this.current;
  }

  undo(): T {
    const previous = this.#past.pop();
    if (previous === undefined) return this.current;
    this.#future.push(clone(this.#present));
    this.#present = previous;
    return this.current;
  }

  redo(): T {
    const next = this.#future.pop();
    if (next === undefined) return this.current;
    this.#past.push(clone(this.#present));
    this.#present = next;
    return this.current;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

