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
  readonly decorationsEnabled: boolean;
  readonly promptToSaveFilesBeforeStash: 'always' | 'staged' | 'never';
  readonly useCommitInputAsStashMessage: boolean;
  readonly openDiffOnClick: boolean;
  readonly showDecorationInFileTree: boolean;
  readonly refreshOnSaveFile: boolean;
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

interface SDCard {
  watchFile(src: string, listener: () => void): { unwatch: () => void };
}

declare var sdcard: SDCard;

declare module 'diff' {
  interface Change {
    value: string;
    added: boolean;
    removed: boolean;
    count: number;
  }

  export function diffLines(
    oldStr: string,
    newStr: string,
    options?: { newlineIsToken?: boolean }
  ): Change[];
}