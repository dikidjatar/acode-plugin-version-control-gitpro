import { IDisposable } from "../base/disposable";
import { Event } from "../base/event";
import { isUri, uriToPath } from "../base/uri";
import { FileSystemWatcher, RelativePattern } from "./fileSystemWatcher";

export interface IFileWatcher extends IDisposable {
  readonly event: Event<string>;
}

export function watch(location: string): IFileWatcher {
  const watcher = new FileSystemWatcher(new RelativePattern(isUri(location) ? uriToPath(location) : location, '*'));

  return new class implements IFileWatcher {
    event: Event<string> = Event.any(watcher.onDidCreate, watcher.onDidChange, watcher.onDidDelete);
    dispose(): void {
      watcher.dispose();
    }
  }
}