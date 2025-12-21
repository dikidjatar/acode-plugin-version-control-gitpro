import { Disposable, IDisposable } from "./disposable";
import { Emitter, Event } from "./event";

const appSettings = acode.require('settings');

function isEqual(a: any, b: any): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function pathToParts(path: string): string[] {
  return path.split('.').filter(Boolean);
}

function getNested(obj: any, parts: string[]): any {
  let cur = obj;
  for (const p of parts) {
    if (!cur) return undefined;
    const idx = Number(p);
    if (!isNaN(idx) && Array.isArray(cur) && String(idx) === p) {
      cur = cur[idx];
    } else {
      cur = cur[p];
    }
  }
  return cur;
}

export interface ConfigurationChangeEvent<T extends keyof Acode.ISettings = keyof Acode.ISettings> {
  affectsConfiguration(key: T): boolean;
  affectsConfiguration(key: `${T}.${any}`): boolean;
  readonly oldValue: Acode.ISettings[T] | undefined;
  readonly newValue: Acode.ISettings[T] | undefined;
}

class Config {

  private readonly _onDidChangeConfiguration = new Emitter<ConfigurationChangeEvent>();
  readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent> = this._onDidChangeConfiguration.event;

  private readonly lastConfigMap: Map<keyof Acode.ISettings, unknown> = new Map();
  private readonly listeners: Map<keyof Acode.ISettings, (value: any) => void> = new Map();

  async init<T extends keyof Acode.ISettings>(key: T, value: Acode.ISettings[T]): Promise<IDisposable> {
    const exiting = appSettings.get(key);
    if (!exiting) {
      appSettings.value[key] = value;
      await appSettings.update({}, true, true);
      this.lastConfigMap.set(key, value);
    } else {
      this.lastConfigMap.set(key, exiting);
    }

    const listener = (newVal: Acode.ISettings[T] | undefined) => {
      this._handleAppSettingsUpdate(key, newVal);
    }

    this.listeners.set(key, listener);
    appSettings.on(`update:${key}`, listener);

    return Disposable.toDisposable(() => {
      this.lastConfigMap.delete(key);
      appSettings.off(`update:${key}`, listener);
      this.listeners.delete(key);
      appSettings.update({ [key]: undefined }, false, true);
    });
  }

  private _handleAppSettingsUpdate<T extends keyof Acode.ISettings>(key: T, newValue: Acode.ISettings[T] | undefined): void {
    const oldValue = this.lastConfigMap.get(key) as Acode.ISettings[T] | undefined;

    if (isEqual(oldValue, newValue)) {
      return;
    }

    const event: ConfigurationChangeEvent<T> = {
      oldValue,
      newValue,
      affectsConfiguration: (affectedKey: T | string): boolean => {
        const affectedParts = pathToParts(affectedKey);
        if (affectedParts.length === 0) {
          return false;
        }

        const watchedParts = pathToParts(key);
        // both must share same top-level root to be related
        if (affectedParts[0] !== watchedParts[0]) {
          return false;
        }

        const affectedSubParts = affectedParts.slice(1);
        if (affectedSubParts.length === 0) {
          return !isEqual(oldValue, newValue);
        }

        const oldSub = getNested(oldValue, affectedSubParts);
        const newSub = getNested(newValue, affectedSubParts);
        return !isEqual(oldSub, newSub);
      }
    };

    this.lastConfigMap.set(key, newValue);
    this._onDidChangeConfiguration.fire(event);
  }

  get<T extends keyof Acode.ISettings>(key: T, defaultValue?: Acode.ISettings[T]): Acode.ISettings[T] {
    const value = appSettings.get(key);
    if (!value && defaultValue) {
      return defaultValue;
    }
    return value;
  }

  async update<T extends keyof Acode.ISettings>(key: T, value: Acode.ISettings[T]): Promise<void> {
    await appSettings.update({ [key]: value } as Partial<Acode.ISettings>, true, true);
    this.lastConfigMap.set(key, value);
  }

  async dispose(): Promise<void> {
    for (const [k, listener] of this.listeners.entries()) {
      const eventName = `update:${k}` as any;
      appSettings.off(eventName, listener);
    }

    for (const key of this.lastConfigMap.keys()) {
      await appSettings.update({ [key]: undefined }, false, true);
    }

    this.listeners.clear();
    this.lastConfigMap.clear();
    this._onDidChangeConfiguration.dispose();
  }
}

export const config = new Config();