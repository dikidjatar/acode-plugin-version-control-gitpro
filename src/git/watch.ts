import { config } from "../base/config";
import { Disposable, IDisposable } from "../base/disposable";
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
  readonly onDidChange = Event.debounce(this._onDidChange.event, (prev, cur) => cur, 1500);

  private disposable: IDisposable
  private enableDisposable: IDisposable = Disposable.None;
  private enabled: boolean = false;

  constructor(private readonly basePath: string) {
    this.disposable = Event.filter(config.onDidChangeConfiguration, e => e.affectsConfiguration('vcgit.refreshOnSaveFile'))(this.onConfigurationChange, this);
    this.onConfigurationChange();
    this.onDidChange(() => {
      console.log('REFRES...');
    });
  }

  private onConfigurationChange(): void {
    const gitConfig = config.get('vcgit')!;
    const enabled = gitConfig.refreshOnSaveFile;
    if (this.enabled === enabled) {
      return;
    }

    if (enabled) {
      this.enable();
    } else {
      this.disable();
    }

    this.enabled = enabled;
  }

  private enable(): void {
    this.enableDisposable = Event.fromEditorManager('save-file')(file => {
      const path = uriToPath(file.uri);
      if (!path.startsWith(this.basePath)) {
        return;
      }

      this._onDidChange.fire(path);
    });
  }

  private disable(): void {
    this.enableDisposable.dispose();
  }

  dispose(): void {
    this.disposable.dispose();
    this.enableDisposable.dispose();
    this._onDidChange.dispose();
  }
}