import { Disposable, DisposableStore, IDisposable } from "./disposable";

export interface Event<T> {
  (listener: (e: T) => any, thisArgs?: any, disposables?: IDisposable[] | DisposableStore): IDisposable;
}

export class Emitter<T> implements IDisposable {
  private _listeners: Set<(e: T) => any> = new Set();
  private _disposed = false;
  private _event?: Event<T>;
  private _deliveryQueue?: T[];
  private _delivering: boolean = false;

  get event(): Event<T> {
    if (!this._event) {
      this._event = (
        listener: (e: any) => any,
        thisArgs?: any,
        disposables?: IDisposable[] | DisposableStore
      ) => {
        if (this._disposed) {
          return Disposable.None;
        }

        const bound = thisArgs ? listener.bind(thisArgs) : listener;
        this._listeners.add(bound);

        const result: IDisposable = {
          dispose: () => {
            if (!this._disposed) {
              this._listeners.delete(bound);
            }
          }
        }

        if (disposables instanceof DisposableStore) {
          disposables.add(result);
        } else if (Array.isArray(disposables)) {
          disposables.push(result);
        }

        return result;
      };
    }
    return this._event;
  }

  fire(event: T): void {
    if (this._disposed) return;

    if (this._delivering) {
      if (!this._deliveryQueue) {
        this._deliveryQueue = [];
      }
      this._deliveryQueue.push(event);
      return;
    }

    this._delivering = true;

    const listeners = Array.from(this._listeners);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn(`Error in event listener:`, err);
      }
    }

    this._delivering = false;

    if (this._deliveryQueue && this._deliveryQueue.length > 0) {
      const queue = this._deliveryQueue;
      this._deliveryQueue = undefined;
      for (const queueEvent of queue) {
        this.fire(queueEvent);
      }
    }
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }

    this._disposed = true;
    this._listeners.clear();
    this._deliveryQueue = undefined;
  }
}

export namespace Event {

  export const None: Event<any> = () => Disposable.None;

  export function forEach<I>(event: Event<I>, each: (i: I) => void): Event<I> {
    return (listener, thisArgs?, disposables?) => {
      return event(i => {
        each(i);
        listener.call(thisArgs, i);
      }, thisArgs, disposables);
    }
  }

  export function once<T>(event: Event<T>): Event<T> {
    return (listener, thisArgs?, disposables?) => {
      const result = event(
        (e) => {
          result.dispose();
          return listener.call(thisArgs, e);
        },
        undefined,
        disposables
      );
      return result;
    };
  }

  export function map<I, O>(event: Event<I>, fn: (i: I) => O): Event<O> {
    return (listener, thisArgs?, disposables?) => {
      return event(
        (i) => listener.call(thisArgs, fn(i)),
        undefined,
        disposables
      );
    };
  }

  export function filter<T>(
    event: Event<T>,
    fn: (e: T) => boolean
  ): Event<T> {
    return (listener, thisArgs?, disposables?) => {
      return event(
        (e) => {
          if (fn(e)) {
            listener.call(thisArgs, e);
          }
        },
        undefined,
        disposables
      );
    };
  }

  export function debounce<T>(
    event: Event<T>,
    merge: (last: T | undefined, event: T) => T,
    delay: number = 100
  ): Event<T> {
    return (listener, thisArgs?, disposables?) => {
      let timeout: any;
      let lastEvent: T | undefined;

      return event(
        (e) => {
          lastEvent = merge(lastEvent, e);

          clearTimeout(timeout);
          timeout = setTimeout(() => {
            listener.call(thisArgs, lastEvent!);
            lastEvent = undefined;
          }, delay);
        },
        undefined,
        disposables
      );
    };
  }

  export function fromDOMEvent<K extends keyof HTMLElementEventMap>(
    element: HTMLElement,
    eventName: K,
    options?: AddEventListenerOptions
  ): Event<HTMLElementEventMap[K]> {
    return (listener, thisArgs?, disposables?) => {
      const handler = (e: HTMLElementEventMap[K]) => listener.call(thisArgs, e);
      element.addEventListener(eventName, handler, options);

      const disposable: IDisposable = {
        dispose: () => {
          element.removeEventListener(eventName, handler, options);
        }
      };

      if (disposables instanceof DisposableStore) {
        disposables.add(disposable);
      } else if (Array.isArray(disposables)) {
        disposables.push(disposable);
      }

      return disposable;
    };
  }

  export function toPromise<T>(event: Event<T>): Promise<T> {
    return new Promise<T>((resolve) => once(event)(resolve));
  }

  export function fromPromise<T>(promise: Promise<T>): Event<T> {
    const emitter = new Emitter<T>();

    promise.then(
      (value) => {
        emitter.fire(value);
        emitter.dispose();
      },
      (error) => {
        console.error('Promise rejected in Event.fromPromise:', error);
        emitter.dispose();
      }
    );

    return emitter.event;
  }

  export function any<T>(...events: Event<T>[]): Event<T> {
    return (listener, thisArgs?, disposables?) => {
      const subscriptions = events.map((event) =>
        event(listener, thisArgs)
      );

      const result = Disposable.create(...subscriptions);

      if (disposables instanceof DisposableStore) {
        disposables.add(result);
      } else if (Array.isArray(disposables)) {
        disposables.push(result);
      }

      return result;
    };
  }

  export function runAndSubscribe<T>(
    event: Event<T>,
    handler: (e: T | undefined) => any
  ): IDisposable {
    handler(undefined);
    return event(handler);
  }
}

export class EventBufferer {

  private data: { buffers: Function[] }[] = [];

  wrapEvent<T>(event: Event<T>): Event<T> {
    return (listener, thisArgs?, disposables?) => {
      return event(i => {
        const data = this.data[this.data.length - 1];

        // Buffering case
        if (data) {
          data.buffers.push(() => listener.call(thisArgs, i));
        } else {
          // Not buffering case
          listener.call(thisArgs, i);
        }
      }, undefined, disposables);
    };
  }

  bufferEvents<R = void>(fn: () => R): R {
    const data = { buffers: new Array<Function>() };
    this.data.push(data);
    const r = fn();
    this.data.pop();
    data.buffers.forEach(flush => flush());
    return r;
  }
}