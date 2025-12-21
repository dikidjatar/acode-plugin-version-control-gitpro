/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from "../base/disposable";
import { Emitter, Event } from "../base/event";
import { config, ConfigurationChangeEvent } from "../base/config";
import { GitErrorCodes } from "./api/git";
import { Repository } from "./repository";

export class AutoFetcher {

  private _onDidChange = new Emitter<boolean>();
  private onDidChange = this._onDidChange.event;

  private _enabled: boolean = false;
  private _fetchAll: boolean = false;
  get enabled(): boolean { return this._enabled; }
  set enabled(enabled: boolean) { this._enabled = enabled; this._onDidChange.fire(enabled); }

  private disposables: IDisposable[] = [];

  constructor(private repository: Repository) {
    config.onDidChangeConfiguration(this.onConfiguration, this, this.disposables);
    this.onConfiguration();
  }

  private onConfiguration(e?: ConfigurationChangeEvent): void {
    if (e !== undefined && !e.affectsConfiguration('vcgit.autofetch')) {
      return;
    }

    const gitConfig = config.get('vcgit')!;
    switch (gitConfig.autofetch) {
      case true:
        this._fetchAll = false;
        this.enable();
        break;
      case 'all':
        this._fetchAll = true;
        this.enable();
        break;
      case false:
      default:
        this._fetchAll = false;
        this.disable();
        break;
    }
  }

  enable(): void {
    if (this.enabled) {
      return;
    }

    this.enabled = true;
    this.run();
  }

  disable(): void {
    this.enabled = false;
  }

  private async run(): Promise<void> {
    while (this.enabled) {
      await this.repository.whenIdle();

      if (!this.enabled) {
        return;
      }

      try {
        if (this._fetchAll) {
          await this.repository.fetchAll({ silent: true });
        } else {
          await this.repository.fetchDefault({ silent: true });
        }
      } catch (err: any) {
        if (err.gitErrorCode === GitErrorCodes.AuthenticationFailed) {
          this.disable();
        }
      }

      if (!this.enabled) {
        return;
      }

      const gitConfig = config.get('vcgit')!;
      const period = gitConfig.autofetchPeriod * 1000;
      const timeout = new Promise(c => setTimeout(c, period));
      const whenDisabled = Event.toPromise(Event.filter(this.onDidChange, enabled => !enabled));

      await Promise.race([timeout, whenDisabled]);
    }
  }

  dispose(): void {
    this.disable();
    this.disposables.forEach(d => d.dispose());
  }
}