import { IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { toFileUrl, uriToPath } from "../base/uri";

export interface IFileWatcher extends IDisposable {
  readonly event: Event<string>;
}

export function watch(location: string): IFileWatcher {
  const onDidWatch = new Emitter<string>();
  const disposable = sdcard.watchFile(toFileUrl(location), () => onDidWatch.fire(location));

  return new class implements IFileWatcher {
    event: Event<string> = onDidWatch.event;
    dispose(): void {
      disposable.unwatch();
    }
  }
}

export class FileWatcher implements IDisposable {

  private readonly _onDidChange = new Emitter<string>();
  private readonly disposable: IDisposable;

  constructor(basePath: string) {
    this.disposable = Event.fromEditorManager('save-file')(file => {
      const path = uriToPath(file.uri);
      if (!path.startsWith(basePath)) {
        return;
      }

      this._onDidChange.fire(path);
    });
  }

  get onDidChange(): Event<string> {
    return this._onDidChange.event;
  }

  dispose(): void {
    this.disposable.dispose();
    this._onDidChange.dispose();
  }
}