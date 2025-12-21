import { App } from "../base/app";
import { Event } from "../base/event";
import { ViewContainer } from "./views";
import { config } from "../base/config";
import { SCMView } from "./scmView";
import './style.scss';
import { ISCMService } from "./types";

class SCMProgress {

  constructor(private view: SCMView | undefined) { }

  show(): void {
    this.view?.title.classList.add('loading');
  }

  hide(): void {
    this.view?.title.classList.remove('loading');
  }
}

export class SCMViewContainer extends ViewContainer {

  constructor(
    private scmService: ISCMService,
  ) {
    super();
    this._register(Event.any(scmService.onDidAddRepository, scmService.onDidRemoveRepository)(() => {
      this.updateViews();
      this._onDidChangeViewWelcomeState.fire();
    }));
    this._register(Event.filter(config.onDidChangeConfiguration, e => e.affectsConfiguration('vcgit') || e.affectsConfiguration('scm'))(() => {
      this.updateViews();
      this._onDidChangeViewWelcomeContent.fire();
    }));
    this._register(App.onDidChangeContext(() => {
      this.updateViews();
      this._onDidChangeViewWelcomeContent.fire();
    }));
  }

  override create(container: HTMLElement): void {
    container.classList.add('scm');
    this.renderHeader(container);
    super.create(container);
  }

  private renderHeader(container: HTMLElement): void {
    const header = container.appendChild(tag('div', { className: 'header' }));
    const title = header.appendChild(tag('div', { className: 'title' }));
    title.appendChild(tag('span', { innerText: 'Source Control' }));
    title.appendChild(tag('div', { className: 'actions' }));
  }

  getProgress() {
    const progress = new SCMProgress(this.getView('scm.view') as SCMView);
    return {
      show: () => {
        progress.show();
      },
      hide: () => {
        progress.hide();
      }
    }
  }

  override shouldShowWelcome(): boolean {
    return this.scmService.repositories.length === 0;
  }
}