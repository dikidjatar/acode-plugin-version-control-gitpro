/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { config } from "../base/config";
import { Disposable, IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { SourceControlActionButton, SourceControlCommandAction } from "../scm/api/sourceControl";
import { Branch, RefType, Status } from "./api/git";
import { OperationKind } from "./operation";
import { Repository } from "./repository";

function isActionButtonStateEqual(state1: ActionButtonState, state2: ActionButtonState): boolean {
  return state1.HEAD?.name === state2.HEAD?.name &&
    state1.HEAD?.commit === state2.HEAD?.commit &&
    state1.HEAD?.remote === state2.HEAD?.remote &&
    state1.HEAD?.type === state2.HEAD?.type &&
    state1.HEAD?.ahead === state2.HEAD?.ahead &&
    state1.HEAD?.behind === state2.HEAD?.behind &&
    state1.HEAD?.upstream?.name === state2.HEAD?.upstream?.name &&
    state1.HEAD?.upstream?.remote === state2.HEAD?.upstream?.remote &&
    state1.HEAD?.upstream?.commit === state2.HEAD?.upstream?.commit &&
    state1.isCheckoutInProgress === state2.isCheckoutInProgress &&
    state1.isCommitInProgress === state2.isCommitInProgress &&
    state1.isMergeInProgress === state2.isMergeInProgress &&
    state1.isRebaseInProgress === state2.isRebaseInProgress &&
    state1.isSyncInProgress === state2.isSyncInProgress &&
    state1.repositoryHasChangesToCommit === state2.repositoryHasChangesToCommit &&
    state1.repositoryHasUnresolvedConflicts === state2.repositoryHasUnresolvedConflicts;
}

interface ActionButtonState {
  readonly HEAD: Branch | undefined;
  readonly isCheckoutInProgress: boolean;
  readonly isCommitInProgress: boolean;
  readonly isMergeInProgress: boolean;
  readonly isRebaseInProgress: boolean;
  readonly isSyncInProgress: boolean;
  readonly repositoryHasChangesToCommit: boolean;
  readonly repositoryHasUnresolvedConflicts: boolean;
}

export class ActionButton {
  
  private _onDidChange = new Emitter<void>();
  get onDidChange(): Event<void> { return this._onDidChange.event; }

  private _state: ActionButtonState;
  private get state() { return this._state; }
  private set state(state: ActionButtonState) {
    if (isActionButtonStateEqual(this._state, state)) {
      return;
    }

    this._state = state;
    this._onDidChange.fire();
  }

  private disposables: IDisposable[] = [];

  constructor(private readonly repository: Repository) {
    this._state = {
      HEAD: undefined,
      isCheckoutInProgress: false,
      isCommitInProgress: false,
      isMergeInProgress: false,
      isRebaseInProgress: false,
      isSyncInProgress: false,
      repositoryHasChangesToCommit: false,
      repositoryHasUnresolvedConflicts: false
    };

    repository.onDidRunGitStatus(this.onDidRunGitStatus, this, this.disposables);
    repository.onDidChangeOperations(this.onDidChangeOperations, this, this.disposables);

    this.disposables.push(config.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('vcgit.enableSmartCommit') ||
        e.affectsConfiguration('vcgit.smartCommitChanges') ||
        e.affectsConfiguration('vcgit.suggestSmartCommit')) {
        this.onDidChangeSmartCommitSettings();
      }
    }));
  }

  get button(): SourceControlActionButton | undefined {
    if (!this.state.HEAD) {
      return undefined;
    }

    let actionButton: SourceControlActionButton | undefined;

    if (this.state.repositoryHasChangesToCommit) {
      // Commit Changes (enabled)
      actionButton = this.getCommitActionButton();
    }

    // Commit Changes (enabled) -> Publish Branch -> Sync Changes -> Commit Changes (disabled)
    actionButton = actionButton ?? this.getPublishBranchActionButton() ?? this.getSyncChangesActionButton() ?? this.getCommitActionButton();

    return actionButton;
  }

  private getCommitActionButton(): SourceControlActionButton | undefined {
    const primaryCommand = this.getCommitActionButtonPrimaryCommand();

    return {
      command: primaryCommand,
      secondaryCommands: this.getCommitActionButtonSecondaryCommands(),
      enabled: (
        this.state.repositoryHasChangesToCommit ||
        (this.state.isRebaseInProgress && !this.state.repositoryHasUnresolvedConflicts) ||
        (this.state.isMergeInProgress && !this.state.repositoryHasUnresolvedConflicts)) &&
        !this.state.isCommitInProgress
    };
  }

  private getCommitActionButtonPrimaryCommand(): SourceControlCommandAction {
    // Rebase Continue
    if (this.state.isRebaseInProgress) {
      return {
        id: `git.commit`,
        title: '$(check) Continue',
        arguments: [this.repository.sourceControl, null]
      }
    }

    // Merge Continue
    if (this.state.isMergeInProgress) {
      return {
        id: 'git.commit',
        title: '$(check) Continue',
        arguments: [this.repository.sourceControl, null]
      };
    }

    // Not a branch (tag, detached)
    if (this.state.HEAD?.type === RefType.Tag || !this.state.HEAD?.name) {
      return {
        id: 'git.commit',
        title: '$(check) Commit',
        arguments: [this.repository.sourceControl, null]
      }
    }

    return {
      id: 'git.commit',
      title: '$(check) Commit',
      arguments: [this.repository.sourceControl, null]
    }
  }

  private getSecondaryCommitCommands(): SourceControlCommandAction[][] {
    return [
      [
        { id: 'git.commit', title: 'Commit', arguments: [this.repository.sourceControl, null] },
        { id: 'git.commitAmend', title: 'Commit (Amend)', arguments: [this.repository.sourceControl, null] },
      ],
      [
        { id: 'git.push', title: 'Commit & Push', arguments: [this.repository.sourceControl, null] },
        { id: 'git.sync', title: 'Commit & Sync', arguments: [this.repository.sourceControl, null] }
      ]
    ]
  }

  private getCommitActionButtonSecondaryCommands(): SourceControlCommandAction[][] {
    // Rebase Continue
    if (this.state.isRebaseInProgress) {
      return [];
    }

    // Merge Continue
    if (this.state.isMergeInProgress) {
      return [];
    }

    // Not a branch (tag, detached)
    if (this.state.HEAD?.type === RefType.Tag || !this.state.HEAD?.name) {
      return [];
    }

    // Commit
    return this.getSecondaryCommitCommands();
  }

  private getPublishBranchActionButton(): SourceControlActionButton | undefined {
    // Not a branch (tag, detached), branch does have an upstream, commit/merge/rebase is in progress, or the button is disabled
    if (this.state.HEAD?.type === RefType.Tag || !this.state.HEAD?.name || this.state.HEAD?.upstream || this.state.isCommitInProgress || this.state.isMergeInProgress || this.state.isRebaseInProgress) { return undefined; }

    // Button icon
    const icon = this.state.isSyncInProgress ? '$(sync~spin)' : '$(cloud-upload)';

    return {
      command: {
        id: 'git.publish',
        title: `${icon} Publish Branch`,
        arguments: [this.repository.sourceControl],
      },
      enabled: !this.state.isCheckoutInProgress && !this.state.isSyncInProgress
    }
  }

  private getSyncChangesActionButton(): SourceControlActionButton | undefined {
    const branchIsAheadOrBehind = (this.state.HEAD?.behind ?? 0) > 0 || (this.state.HEAD?.ahead ?? 0) > 0;

    // Branch does not have an upstream, branch is not ahead/behind the remote branch, commit/merge/rebase is in progress, or the button is disabled
    if (!this.state.HEAD?.upstream || !branchIsAheadOrBehind || this.state.isCommitInProgress || this.state.isMergeInProgress || this.state.isRebaseInProgress) { return undefined; }

    const ahead = this.state.HEAD.ahead ? ` ${this.state.HEAD.ahead}↑` : '';
    const behind = this.state.HEAD.behind ? ` ${this.state.HEAD.behind}↓` : '';
    const icon = this.state.isSyncInProgress ? '$(sync~spin)' : '$(sync)';

    return {
      command: {
        id: 'git.sync',
        title: `${icon} Sync Changes ${ahead}${behind}`,
        arguments: [this.repository.sourceControl],
      },
      enabled: !this.state.isCheckoutInProgress && !this.state.isSyncInProgress
    }
  }

  private onDidChangeOperations(): void {
    const isCheckoutInProgress
      = this.repository.operations.isRunning(OperationKind.Checkout) ||
      this.repository.operations.isRunning(OperationKind.CheckoutTracking);

    const isCommitInProgress =
      this.repository.operations.isRunning(OperationKind.Commit) ||
      this.repository.operations.isRunning(OperationKind.PostCommitCommand) ||
      this.repository.operations.isRunning(OperationKind.RebaseContinue);

    const isSyncInProgress =
      this.repository.operations.isRunning(OperationKind.Sync) ||
      this.repository.operations.isRunning(OperationKind.Push) ||
      this.repository.operations.isRunning(OperationKind.Pull);

    this.state = { ...this.state, isCheckoutInProgress, isCommitInProgress, isSyncInProgress };
  }

  private onDidChangeSmartCommitSettings(): void {
    this.state = {
      ...this.state,
      repositoryHasChangesToCommit: this.repositoryHasChangesToCommit()
    };
  }

  private onDidRunGitStatus(): void {
    this.state = {
      ...this.state,
      HEAD: this.repository.HEAD,
      isMergeInProgress: this.repository.mergeInProgress,
      isRebaseInProgress: !!this.repository.rebaseCommit,
      repositoryHasChangesToCommit: this.repositoryHasChangesToCommit(),
      repositoryHasUnresolvedConflicts: this.repository.mergeGroup.resourceStates.length > 0
    };
  }

  private repositoryHasChangesToCommit(): boolean {
    const gitConfig = config.get('vcgit')!;
    const enableSmartCommit = gitConfig.enableSmartCommit;
    const suggestSmartCommit = gitConfig.suggestSmartCommit;
    const smartCommitChanges = gitConfig.smartCommitChanges;

    const resources = [...this.repository.indexGroup.resourceStates];

    if (
      // Smart commit enabled (all)
      (enableSmartCommit && smartCommitChanges === 'all') ||
      // Smart commit disabled, smart suggestion enabled
      (!enableSmartCommit && suggestSmartCommit)
    ) {
      resources.push(...this.repository.workingTreeGroup.resourceStates);
    }

    // Smart commit enabled (tracked only)
    if (enableSmartCommit && smartCommitChanges === 'tracked') {
      resources.push(...this.repository.workingTreeGroup.resourceStates.filter(r => r.type !== Status.UNTRACKED));
    }

    return resources.length !== 0;
  }

  dispose(): void {
    this.disposables = Disposable.dispose(this.disposables);
  }
}