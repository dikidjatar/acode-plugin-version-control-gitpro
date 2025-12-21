declare const app: HTMLBodyElement;
declare const strings: { [key: string]: string };
declare const Terminal: Terminal;
declare const Executor: Executor;
declare const system: any;

interface Terminal {
  isInstalled(): Promise<boolean>;
}

interface Executor {
  execute(command: string, alpine?: boolean): Promise<string>;
  /**
   * @returns uuid
   */
  start(command: string, onData: (type: string, data: string) => void, alpine?: boolean): Promise<string>;
  isRunning(uuid: string): Promise<boolean>;
  write(uuid: string, input: string): Promise<void>;
  stop(uuid: string): Promise<void>;
}

interface ISCMConfig {
  readonly inputMaxLineCount: number;
  readonly inputMinLineCount: number;
  readonly showActionButton: boolean;
  readonly alwaysShowRepositories: boolean;
  readonly selectionMode: 'single' | 'multiple';
  readonly defaultViewMode: 'list' | 'tree';
}

interface IGitConfig {
  readonly enabled: boolean;
  readonly openAfterClone: 'prompt' | 'always' | 'whenNoFolderOpen';
  readonly defaultBranchName: string;
  readonly untrackedChanges: 'mixed' | 'separate' | 'hidden';
  readonly ignoreSubmodules: boolean;
  readonly statusLimit: number;
  readonly similarityThreshold: number;
  readonly commandsToLog: string[],
  readonly alwaysShowStagedChangesResourceGroup: boolean;
  readonly autoRepositoryDetection: boolean | 'subFolders';
  readonly repositoryScanMaxDepth: number;
  readonly repositoryScanIgnoredFolders: string[],
  readonly ignoreLegacyWarning: boolean;
  readonly ignoreMissingGitWarning: boolean;
  readonly branchWhitespaceChar: string;
  readonly showCommitInput: boolean;
  readonly autorefresh: boolean;
  readonly showProgress: boolean;
  readonly ignoreLimitWarning: boolean;
  readonly enableStatusBarSync: boolean;
  readonly commitShortHashLength: number;
  readonly checkoutType: 'local' | 'remote' | 'tags' | 'all';
  readonly showReferenceDetails: boolean;
  readonly branchSortOrder: 'alphabetically' | 'committerdate';
  readonly pullBeforeCheckout: boolean;
  readonly branchPrefix: string;
  readonly branchValidationRegex: string;
  readonly pruneOnFetch: boolean;
  readonly enableSmartCommit: boolean;
  readonly smartCommitChanges: 'all' | 'tracked';
  readonly suggestSmartCommit: boolean;
  readonly useEditorAsCommitInput: boolean;
  readonly promptToSaveFilesBeforeCommit: 'always' | 'staged' | 'never';
  readonly verboseCommit: boolean;
  readonly allowNoVerifyCommit: boolean;
  readonly confirmNoVerifyCommit: boolean;
  readonly requireGitUserConfig: boolean;
  readonly confirmEmptyCommits: boolean;
  readonly autoStash: boolean;
  readonly fetchOnPull: boolean;
  readonly pullTags: boolean;
  readonly ignoreRebaseWarning: boolean;
  readonly replaceTagsWhenPull: boolean;
  readonly allowForcePush: boolean;
  readonly useForcePushWithLease: boolean;
  readonly useForcePushIfIncludes: boolean;
  readonly confirmForcePush: boolean;
  readonly rebaseWhenSync: boolean;
  readonly confirmSync: boolean;
  readonly followTagsWhenSync: boolean;
  readonly useIntegratedAskPass: boolean;
  readonly autofetch: boolean | 'all';
  readonly autofetchPeriod: number;
  readonly detectSubmodules: boolean;
  readonly detectSubmodulesLimit: number;
  readonly useInotifywait: boolean;
  readonly decorationsEnabled: boolean;
}

declare namespace Acode {
  interface ISettings {
    vcgit: IGitConfig | undefined;
    scm: ISCMConfig | undefined;
  }
}

interface Window {
  BuildInfo: {
    packageName: string;
  }
}