import { Event } from "../../base/event";

export interface SourceControl {
  readonly id: string;
  readonly label: string;
  readonly rootUri?: string;
  readonly inputBox: SourceControlInputBox;
  count?: number;
  commandActions: SourceControlCommandAction[] | undefined;
  actionButton: SourceControlActionButton | undefined;
  readonly selected: boolean;
  createResourceGroup(id: string, label: string): SourceControlResourceGroup;
  readonly onDidChangeSelection: Event<boolean>;
  dispose(): void;
}

export interface SourceControlInputBox {
  value: string;
  readonly onDidChange: Event<string>;
  placeholder: string;
  enabled: boolean;
  visible: boolean;
}

export interface SourceControlResourceGroup {
  readonly id: string;
  label: string;
  hideWhenEmpty?: boolean;
  resourceStates: SourceControlResourceState[];
  dispose(): void;
}

export interface SourceControlResourceState {
  readonly resourceUri: string;
  decorations?: SourceControlResourceDecorations;
  command?: SourceControlCommandAction;
}

export interface SourceControlResourceDecorations {
  icon?: string;
  strikeThrough?: boolean;
  letter?: string;
  color?: string;
}

export interface SourceControlActionButton {
  command: SourceControlCommandAction;
  secondaryCommands?: SourceControlCommandAction[][];
  enabled: boolean;
}

export interface SourceControlCommandAction {
  id: string;
  title: string;
  arguments?: unknown[];
}

export interface SourceControlProgess {
  show(): void;
  hide(): void;
}

export interface SourceControlViewWelcomeContent {
  readonly content: string;
  when(): boolean | 'default';
}

export interface SourceControlViewContainer {
  registerViewWelcomeContent(viewContent: SourceControlViewWelcomeContent): any;
  updateViews(): void;
  getProgress(): SourceControlProgess;
}

export interface SourceControlMenuContext {
  scmProvider?: string;
  scmProviderRootUri?: string;
  scmProviderHasRoorUri?: boolean;
  scmResourceGroup?: string;
}

export interface SourceControlMenuItem {
  command: SourceControlCommandAction;
  group?: 'navigation' | string;
  submenu?: boolean;
  enablement?: () => boolean;
  when?: (context: SourceControlMenuContext) => boolean;
}