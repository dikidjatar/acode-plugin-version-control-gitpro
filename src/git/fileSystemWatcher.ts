import { IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { config, ConfigurationChangeEvent } from "../base/config";

async function findInotify(): Promise<string | undefined> {
  try {
    const result = await Executor.execute('which inotifywait', true);
    return result.trim();
  } catch (err) {
    return undefined;
  }
}

export class RelativePattern {
  constructor(public base: string, public pattern: string) { }

  toRegExp(): RegExp {
    const esc = (s: string) => s.replace(/[.+^${}()|[\]\\*?]/g, "\\$&");
    const pattern = this.pattern
      .split("/")
      .map((segment) => {
        if (segment === "**") return ".*";
        segment = esc(segment);
        segment = segment.replace(/\\\*/g, "[^/]*");
        segment = segment.replace(/\\\?/g, "[^/]");
        return segment;
      })
      .join("/");
    return new RegExp("^" + pattern + "$");
  }
}

export class FileSystemWatcher implements IDisposable {

  private readonly _onDidCreate = new Emitter<string>();
  private readonly _onDidDelete = new Emitter<string>();
  private readonly _onDidChange = new Emitter<string>();

  private readonly watchPath: string;
  private readonly filter: (path: string) => boolean;
  private enabled: boolean = false;
  private isDisposed: boolean = false;
  private readonly disposables: IDisposable[] = [];

  constructor(pattern: RelativePattern | string) {
    if (pattern instanceof RelativePattern) {
      this.watchPath = pattern.base.replace(/\/$/, "");
      this.filter = this._compilePattern(pattern);
    } else {
      this.watchPath = pattern.replace(/\/$/, "");
      this.filter = () => true;
    }

    config.onDidChangeConfiguration(this.onConfiguration, this, this.disposables);
    this.onConfiguration();
  }

  private _compilePattern(pattern: RelativePattern): (path: string) => boolean {
    const base = pattern.base.replace(/\/$/, '');
    const regex = pattern.toRegExp();

    return (abs: string) => {
      if (!abs.startsWith(base)) return false;
      const rel = abs.substring(base.length + 1);
      return regex.test(rel);
    }
  }

  private onConfiguration(e?: ConfigurationChangeEvent): void {
    if (e !== undefined && !e.affectsConfiguration('vcgit.useInotifywait')) {
      return;
    }

    const gitConfig = config.get('vcgit');
    if (gitConfig?.useInotifywait === true) {
      this.enable();
    } else {
      this.disable();
    }
  }

  private enable(): void {
    if (this.enabled) {
      return;
    }

    this.enabled = true;
    this.start();
  }

  private disable(): void {
    this.enabled = false;
  }

  private async start(): Promise<void> {
    const inotifywait = await findInotify();

    if (!inotifywait) {
      return;
    }

    while (this.enabled && !this.isDisposed) {
      try {
        const data = await new Promise<string | undefined>(async (c) => {
          const timeout = setTimeout(() => c(undefined), 180000);
          const result = await Executor.execute(`${inotifywait} -r -q --format '%e|%w%f' -e create,delete,modify,move '${this.watchPath}'`, true);
          clearTimeout(timeout);
          c(result);
        });

        if (!this.enabled) {
          return;
        }

        if (typeof data !== 'undefined') {
          this.onOutput(data);
        }
      } catch { }
    }
  }

  private onOutput(stdout: string): void {
    const [events, path] = stdout.split('|');

    if (!path) {
      return;
    }

    if (!this.filter(path)) {
      return;
    }

    const eventList = events.split(',');

    if (eventList.some(e => e.includes('CREATE') || e.includes('MOVED_TO'))) {
      this._onDidCreate.fire(path);
    }
    else if (eventList.some(e => e.includes('DELETE') || e.includes('MOVED_FROM'))) {
      this._onDidDelete.fire(path);
    }
    else if (eventList.some(e => e.includes('MODIFY') || e.includes('CLOSE_WRITE'))) {
      this._onDidChange.fire(path);
    }
  }

  get onDidCreate(): Event<string> {
    return this._onDidCreate.event;
  }

  get onDidDelete(): Event<string> {
    return this._onDidDelete.event;
  }

  get onDidChange(): Event<string> {
    return this._onDidChange.event;
  }

  dispose(): void {
    this.disable();
    this._onDidCreate.dispose();
    this._onDidDelete.dispose();
    this._onDidChange.dispose();
    this.isDisposed = true;
  }
}