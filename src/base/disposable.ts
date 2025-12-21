export interface IDisposable {
  dispose(): void;
}

export namespace Disposable {
  export const None: IDisposable = Object.freeze({ dispose() { } });

  export function create(...disposables: IDisposable[]): IDisposable {
    return {
      dispose: () => {
        for (const d of disposables) {
          d.dispose();
        }
      }
    }
  }

  export function isDisposable(obj: any): obj is IDisposable {
    return (obj !== null && typeof obj === 'object' && typeof obj.dispose === 'function');
  }

  export function toDisposable(dispose: () => void): IDisposable {
    return { dispose };
  }

  export function dispose<T extends IDisposable>(disposables: T[]): T[] {
    disposables.forEach(d => d.dispose());
    return [];
  }

  export abstract class Disposable {
    private readonly _store = new DisposableStore();

    protected _register<T extends IDisposable>(value: T): T {
      if ((value as unknown as Disposable) === this) {
        throw new Error('Cannot register a disposable on itself!');
      }
      return this._store.add(value);
    }

    public dispose(): void {
      this._store.dispose();
    }
  }
}

export class DisposableStore implements IDisposable {
  private _toDispose = new Set<IDisposable>();
  private _disposed = false;

  add<T extends IDisposable>(o: T): T {
    if (!o || o === Disposable.None) {
      return o;
    }
    if ((o as unknown as DisposableStore) === this) {
      throw new Error('Cannot register a disposable on itself!');
    }

    if (this._disposed) {
      console.warn(new Error('Trying to add a disposable to a DisposableStore that has already been disposed of. The added object will be leaked!').stack);
    } else {
      this._toDispose.add(o);
    }

    return o;
  }

  public delete<T extends IDisposable>(o: T): void {
    if (!o) {
      return;
    }
    if ((o as unknown as DisposableStore) === this) {
      throw new Error('Cannot dispose a disposable on itself!');
    }
    this._toDispose.delete(o);
    o.dispose();
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }

    for (const disposable of this._toDispose) {
      disposable.dispose();
    }

    this._disposed = true;
    this._toDispose.clear();
  }

  clear(): void {
    if (this._toDispose.size === 0) {
      return;
    }

    for (const disposable of this._toDispose) {
      try {
        disposable.dispose();
      } catch {
        // ignore
      }
    }

    this._toDispose.clear();
  }

  get disposed(): boolean {
    return this._disposed;
  }
}

export class DisposableMap<K, V extends IDisposable = IDisposable> implements IDisposable {

  private readonly _store = new Map<K, V>();
  private _isDisposed = false;

  dispose(): void {
    this._isDisposed = true;

  }

  clearAndDisposeAll(): void {
    if (!this._store.size) {
      return;
    }

    try {
      for (const d of this._store.values()) {
        d.dispose();
      }
    } finally {
      this._store.clear();
    }
  }

  has(key: K): boolean {
    return this._store.has(key);
  }

  get(key: K): V | undefined {
    return this._store.get(key);
  }

  set(key: K, value: V, skipDisposeOnOverwrite = false): void {
    if (this._isDisposed) {
      console.warn(new Error('Trying to add a disposable to a DisposableMap that has already been disposed of. The added object will be leaked!').stack);
    }

    if (!skipDisposeOnOverwrite) {
      this._store.get(key)?.dispose();
    }

    this._store.set(key, value);
  }

  deleteAndDispose(key: K): void {
    this._store.get(key)?.dispose();
    this._store.delete(key);
  }

  keys(): IterableIterator<K> {
    return this._store.keys();
  }

  values(): IterableIterator<V> {
    return this._store.values();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this._store[Symbol.iterator]();
  }
}