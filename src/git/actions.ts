import { config } from "../base/config";
import { IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { SourceControlCommandAction } from "../scm/api/sourceControl";
import { Branch, RefType, RemoteSourcePublisher } from "./api/git";
import { CheckoutOperation, CheckoutTrackingOperation, OperationKind } from "./operation";
import { IRemoteSourcePublisherRegistry } from "./remotePublisher";
import { Repository } from "./repository";

interface CheckoutCommandActionState {
  readonly isCheckoutRunning: boolean;
  readonly isCommitRunning: boolean;
  readonly isSyncRunning: boolean;
}

class CheckoutCommandAction {

  private _onDidChange = new Emitter<void>();
  get onDidChange() { return this._onDidChange.event; }
  private disposables: IDisposable[] = [];

  private _state: CheckoutCommandActionState;
  get state(): CheckoutCommandActionState { return this._state; }
  set state(state: CheckoutCommandActionState) {
    this._state = state;
    this._onDidChange.fire();
  }

  constructor(private repository: Repository) {
    this._state = {
      isCheckoutRunning: false,
      isCommitRunning: false,
      isSyncRunning: false
    }

    repository.onDidChangeOperations(this.onDidChangeOperations, this, this.disposables);
    repository.onDidRunGitStatus(this._onDidChange.fire, this._onDidChange, this.disposables);
  }

  get command(): SourceControlCommandAction {
    const operationData = [
      ...this.repository.operations.getOperations(OperationKind.Checkout) as CheckoutOperation[],
      ...this.repository.operations.getOperations(OperationKind.CheckoutTracking) as CheckoutTrackingOperation[]
    ];

    const rebasing = !!this.repository.rebaseCommit;
    const label = operationData[0]?.refLabel ?? `${this.repository.headLabel}${rebasing ? ` (Rebasing)` : ''}`;
    const command = (this.state.isCheckoutRunning || this.state.isCommitRunning || this.state.isSyncRunning) ? '' : 'git.checkout';

    return {
      id: command,
      title: `${this.getIcon()} ${label}`,
      arguments: [this.repository.sourceControl]
    }
  }

  private getIcon(): string {
    if (!this.repository.HEAD) {
      return '';
    }

    if (this.state.isCheckoutRunning) {
      return '$(loading~spin)';
    }

    if (this.repository.HEAD.type === RefType.Head && this.repository.HEAD.name) {
      return '$(branch)';
    }

    if (this.repository.HEAD.type === RefType.Tag) {
      return '$(tag)';
    }

    return '$(git-commit)';
  }

  private onDidChangeOperations(): void {
    const isCommitRunning = this.repository.operations.isRunning(OperationKind.Commit);
    const isCheckoutRunning = this.repository.operations.isRunning(OperationKind.Checkout) ||
      this.repository.operations.isRunning(OperationKind.CheckoutTracking);
    const isSyncRunning = this.repository.operations.isRunning(OperationKind.Sync) ||
      this.repository.operations.isRunning(OperationKind.Push) ||
      this.repository.operations.isRunning(OperationKind.Pull);

    this.state = { ...this.state, isCheckoutRunning, isCommitRunning, isSyncRunning };
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}

interface SyncState {
  readonly enabled: boolean;
  readonly isCheckoutRunning: boolean;
  readonly isCommitRunning: boolean;
  readonly isSyncRunning: boolean;
  readonly hasRemotes: boolean;
  readonly HEAD: Branch | undefined;
  readonly remoteSourcePublishers: RemoteSourcePublisher[];
}

class SyncCommandAction {

  private _onDidChange = new Emitter<void>();
  get onDidChange(): Event<void> { return this._onDidChange.event; }
  private disposables: IDisposable[] = [];

  private _state: SyncState;
  private get state() { return this._state; }
  private set state(state: SyncState) {
    this._state = state;
    this._onDidChange.fire();
  }

  constructor(private repository: Repository, private remoteSourcePublisherRegistry: IRemoteSourcePublisherRegistry) {
    this._state = {
      enabled: true,
      isCheckoutRunning: false,
      isCommitRunning: false,
      isSyncRunning: false,
      hasRemotes: false,
      HEAD: undefined,
      remoteSourcePublishers: remoteSourcePublisherRegistry.getRemoteSourcePublishers()
    };

    repository.onDidRunGitStatus(this.onDidRunGitStatus, this, this.disposables);
    repository.onDidChangeOperations(this.onDidChangeOperations, this, this.disposables);

    Event.any(remoteSourcePublisherRegistry.onDidAddRemoteSourcePublisher, remoteSourcePublisherRegistry.onDidRemoveRemoteSourcePublisher)(this.onDidChangeRemoteSourcePublishers, this, this.disposables);

    const onEnablementChange = Event.filter(config.onDidChangeConfiguration, e => e.affectsConfiguration('vcgit.enableStatusBarSync'));
    onEnablementChange(this.updateEnablement, this, this.disposables);
    this.updateEnablement();
  }

  private updateEnablement(): void {
    const gitConfig = config.get('vcgit')!;
    const enabled = gitConfig.enableStatusBarSync;

    this.state = { ...this.state, enabled };
  }

  private onDidChangeOperations(): void {
    const isCommitRunning = this.repository.operations.isRunning(OperationKind.Commit);
    const isCheckoutRunning = this.repository.operations.isRunning(OperationKind.Checkout) ||
      this.repository.operations.isRunning(OperationKind.CheckoutTracking);
    const isSyncRunning = this.repository.operations.isRunning(OperationKind.Sync) ||
      this.repository.operations.isRunning(OperationKind.Push) ||
      this.repository.operations.isRunning(OperationKind.Pull);

    this.state = { ...this.state, isCheckoutRunning, isCommitRunning, isSyncRunning };
  }

  private onDidRunGitStatus(): void {
    this.state = {
      ...this.state,
      hasRemotes: this.repository.remotes.length > 0,
      HEAD: this.repository.HEAD
    };
  }

  private onDidChangeRemoteSourcePublishers(): void {
    this.state = {
      ...this.state,
      remoteSourcePublishers: this.remoteSourcePublisherRegistry.getRemoteSourcePublishers()
    };
  }

  get command(): SourceControlCommandAction | undefined {
    if (!this.state.enabled) {
      return;
    }

    if (!this.state.hasRemotes) {
      if (this.state.remoteSourcePublishers.length === 0) {
        return;
      }

      const command = (this.state.isCheckoutRunning || this.state.isCommitRunning) ? '' : 'git.publish';

      return {
        id: command,
        title: `$(cloud-upload)`,
        arguments: [this.repository.sourceControl]
      }
    }
``
    const HEAD = this.state.HEAD;
    let icon = 'sync';
    let text = '';
    let command = '';

    if (HEAD && HEAD.name && HEAD.commit) {
      if (HEAD.upstream) {
        if (HEAD.ahead || HEAD.behind) {
          text += this.repository.syncLabel;
        }

        command = 'git.sync';
      } else {
        icon = 'cloud-upload';
        command = 'git.publish';
      }
    } else {
      command = '';
    }

    if (this.state.isCheckoutRunning || this.state.isCommitRunning || this.state.isSyncRunning) {
      command = '';
    }

    return {
      id: command,
      title: `$(${icon}) ${text}`,
      arguments: [this.repository.sourceControl]
    };
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}

export class CommandActions {

  readonly onDidChange: Event<void>;

  private checkoutCommandAction: CheckoutCommandAction;
  private syncCommandAction: SyncCommandAction;

  constructor(repository: Repository, remoteSourcePublisherRegistry: IRemoteSourcePublisherRegistry) {
    this.checkoutCommandAction = new CheckoutCommandAction(repository);
    this.syncCommandAction = new SyncCommandAction(repository, remoteSourcePublisherRegistry);
    this.onDidChange = Event.any(this.checkoutCommandAction.onDidChange, this.syncCommandAction.onDidChange);
  }

  get commands(): SourceControlCommandAction[] {
    return [this.checkoutCommandAction.command, this.syncCommandAction.command].filter((cmd): cmd is SourceControlCommandAction => !!cmd);
  }

  dispose(): void {
    this.checkoutCommandAction.dispose();
    this.syncCommandAction.dispose();
  }
}