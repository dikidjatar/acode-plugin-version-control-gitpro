import { Disposable, DisposableStore, IDisposable } from "./disposable";
import { Emitter, Event } from "./event";

export class FileDecoration {
  badge?: string;

  color?: string;

  propagate?: boolean;

  constructor(badge?: string, color?: string) {
    this.badge = badge;
    this.color = color;
  }
}

export interface DecorationProvider extends IDisposable {
  onDidChangeFileDecorations: Event<string[] | undefined>;
  provideFileDecoration(
    uri: string,
  ): FileDecoration | undefined | Promise<FileDecoration | undefined>;
}

class DecorationDataRequest {
  constructor(
    readonly thenable: Promise<void>,
  ) { }
}

type DecorationEntry = Map<DecorationProvider, DecorationDataRequest | FileDecoration | null>;

class DecorationsService {

  private readonly _store = new DisposableStore();
  private _provider: DecorationProvider[] = [];
  private readonly _data: Map<string, DecorationEntry> = new Map();

  private readonly _onDidChangeDecorations = new Emitter<void>();
  readonly onDidChangeDecorations = this._onDidChangeDecorations.event;

  registerFileDecorationProvider(
    provider: DecorationProvider,
  ): IDisposable {
    this._provider.unshift(provider);

    this._onDidChangeDecorations.fire();

    const removeAll = () => {
      const uris: string[] = [];
      for (const [uri, map] of this._data) {
        if (map.delete(provider)) {
          uris.push(uri);
        }
      }
      if (uris.length > 0) {
        this._onDidChangeDecorations.fire();
      }
    }

    const listener = provider
      .onDidChangeFileDecorations(uris => {
        if (!uris) {
          removeAll();
        } else {
          for (const uri of uris) {
            const map = this._ensureEntry(uri);
            this._fetchData(map, uri, provider);
          }
        }
      });

    return Disposable.toDisposable(() => {
      this._provider = this._provider.filter(p => p !== provider);
      listener.dispose();
      removeAll();
    });
  }

  private _ensureEntry(uri: string): DecorationEntry {
    let map = this._data.get(uri);
    if (!map) {
      map = new Map();
      this._data.set(uri, map);
    }
    return map;
  }

  getDecoration(uri: string): FileDecoration | undefined {
    let all: FileDecoration[] = [];

    const map = this._ensureEntry(uri);

    for (const provider of this._provider) {
      let data = map.get(provider);
      if (data === undefined) {
        data = this._fetchData(map, uri, provider);
      }

      if (data && !(data instanceof DecorationDataRequest)) {
        all.push(data);
      }
    }

    return all.length === 0 ? undefined : all[0];
  }

  private _fetchData(map: DecorationEntry, uri: string, provider: DecorationProvider): FileDecoration | null {
    const pendingRequest = map.get(provider);
    if (pendingRequest instanceof DecorationDataRequest) {
      map.delete(provider);
    }

    const dataOrPromise = provider.provideFileDecoration(uri);
    if (!(dataOrPromise instanceof Promise)) {
      return this._keepItem(map, provider, dataOrPromise);
    } else {
      const request = new DecorationDataRequest(Promise.resolve(dataOrPromise).then(data => {
        if (map.get(provider) === request) {
          this._keepItem(map, provider, data);
        }
      }).catch(() => {
        if (map.get(provider) === request) {
          map.delete(provider);
        }
      }));

      map.set(provider, request);
      return null;
    }
  }

  private _keepItem(map: DecorationEntry, provider: DecorationProvider, data: FileDecoration | undefined): FileDecoration | null {
    const deco = data ? data : null;
    const old = map.get(provider);
    map.set(provider, deco);
    if (deco || old) {
      this._onDidChangeDecorations.fire();
    }
    return deco;
  }

  dispose(): void {
    this._store.dispose();
    this._data.clear();
  }
}

export const decorationService = new DecorationsService();