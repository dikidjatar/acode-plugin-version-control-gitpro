import { Emitter, Event } from "../../base/event";
import { Model } from "../model";
import { ApiImpl } from "./api1";
import { API, GitExtension } from "./git";

export class GitPluginImpl implements GitExtension {

  enabled: boolean = false;

  private _onDidChangeEnablement = new Emitter<boolean>();
  readonly onDidChangeEnablement: Event<boolean> = this._onDidChangeEnablement.event;

  private _model: Model | undefined = undefined;

  set model(model: Model | undefined) {
    this._model = model;

    const enabled = !!model;

    if (this.enabled === enabled) {
      return;
    }

    this.enabled = enabled;
    this._onDidChangeEnablement.fire(this.enabled);
  }

  get model(): Model | undefined {
    return this._model;
  }

  constructor(model?: Model) {
    if (model) {
      this.enabled = true;
      this._model = model;
    }
  }

  getAPI(version: 1): API {
    if (!this._model) {
      throw new Error('Git model not found');
    }

    if (version !== 1) {
      throw new Error(`No API version ${version} found.`);
    }

    return new ApiImpl(this._model);
  }
}