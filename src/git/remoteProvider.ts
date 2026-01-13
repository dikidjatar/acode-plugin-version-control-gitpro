import { IDisposable } from "../base/disposable";
import { Event } from "../base/event";
import { PickRemoteSourceOptions, RemoteSourceProvider } from "./api/git";

export interface IRemoteSourceProviderRegistry {
  readonly onDidAddRemoteSourceProvider: Event<RemoteSourceProvider>;
  readonly onDidRemoveRemoteSourceProvider: Event<RemoteSourceProvider>;

  registerRemoteSourceProvider(provider: RemoteSourceProvider): IDisposable;
  pickRemoteSource(options: PickRemoteSourceOptions): Promise<string | undefined>;
}