import { App } from "../base/app";
import { Disposable, DisposableStore } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { ISCMInput, ISCMInputChangeEvent, ISCMProvider, ISCMRepository, ISCMService } from "./types";

class SCMInput extends Disposable.Disposable implements ISCMInput {

  private _value = '';

  get value(): string {
    return this._value;
  }

  private readonly _onDidChange = new Emitter<ISCMInputChangeEvent>();
  readonly onDidChange: Event<ISCMInputChangeEvent> = this._onDidChange.event;

  private _placeholder = '';

  get placeholder(): string {
    return this._placeholder;
  }

  set placeholder(placeholder: string) {
    this._placeholder = placeholder;
    this._onDidChangePlaceholder.fire(placeholder);
  }

  private readonly _onDidChangePlaceholder = new Emitter<string>();
  readonly onDidChangePlaceholder: Event<string> = this._onDidChangePlaceholder.event;

  private _enabled = true;

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(enabled: boolean) {
    this._enabled = enabled;
    this._onDidChangeEnablement.fire(enabled);
  }

  private readonly _onDidChangeEnablement = new Emitter<boolean>();
  readonly onDidChangeEnablement: Event<boolean> = this._onDidChangeEnablement.event;

  private _visible = true;

  get visible(): boolean {
    return this._visible;
  }

  set visible(visible: boolean) {
    this._visible = visible;
    this._onDidChangeVisibility.fire(visible);
  }

  private readonly _onDidChangeVisibility = new Emitter<boolean>();
  readonly onDidChangeVisibility: Event<boolean> = this._onDidChangeVisibility.event;

  constructor(
    readonly repository: ISCMRepository
  ) {
    super();
  }

  setValue(value: string): void {
    if (value === this._value) {
      return;
    }

    this._value = value;
    this._onDidChange.fire({ value });
  }
}

class SCMRepository implements ISCMRepository {

  private _selected: boolean = false;
  get selected(): boolean {
    return this._selected;
  }

  readonly input: ISCMInput;

  private _onDidChangeSelection = new Emitter<boolean>();
  readonly onDidChangeSelection: Event<boolean> = this._onDidChangeSelection.event;

  constructor(
    public readonly id: string,
    public readonly provider: ISCMProvider,
    private readonly disposables: DisposableStore
  ) {
    this.input = new SCMInput(this);
  }

  setSelected(selected: boolean): void {
    if (this._selected === selected) {
      return;
    }

    this._selected = selected;
    this._onDidChangeSelection.fire(selected);
  }

  dispose(): void {
    this.disposables.dispose();
    this.provider.dispose();
  }
}

export class SCMService implements ISCMService {

  private _repositories: Map<string, ISCMRepository> = new Map();
  get repositories(): ISCMRepository[] {
    return Array.from(this._repositories.values());
  }

  get repositoryCount(): number {
    return this._repositories.size;
  }

  private _onDidAddProvider = new Emitter<ISCMRepository>();
  readonly onDidAddRepository: Event<ISCMRepository> = this._onDidAddProvider.event;

  private _onDidRemoveProvider = new Emitter<ISCMRepository>();
  readonly onDidRemoveRepository: Event<ISCMRepository> = this._onDidRemoveProvider.event;

  constructor() {
    App.setContext('scm.providerCount', 0);
  }

  registerSCMProvider(provider: ISCMProvider): ISCMRepository {
    if (this._repositories.has(provider.id)) {
      throw new Error(`SCM provider '${provider.id}' already exsists`);
    }

    const disposables = new DisposableStore();

    disposables.add(Disposable.toDisposable(() => {
      this._repositories.delete(provider.id);
      App.setContext('scm.providerCount', this._repositories.size);
      this._onDidRemoveProvider.fire(repository);
    }));

    const repository = new SCMRepository(provider.id, provider, disposables);
    this._repositories.set(provider.id, repository);

    App.setContext('scm.providerCount', this._repositories.size);

    this._onDidAddProvider.fire(repository);
    return repository;
  }

  getRepository(id: string): ISCMRepository | undefined {
    return this._repositories.get(id);
  }
}