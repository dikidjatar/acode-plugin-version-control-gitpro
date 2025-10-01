interface ActionButtonOptions {
  className: string,
  icon: string,
  onclick?: () => void
}

type FileStatus = {
  key: string,
  filepath: string;
  /** Single-letter representation, e.g., 'A', 'U' */
  symbol: string;
  isStaged: boolean,
  isUnstaged: boolean;
  isIgnored: boolean;
  desc: string
};

interface SidebarInitOptions {
  onRefreshButtonClick: () => void;
  onInitButtonClick: () => void;
  onCloneButtonClick: () => void;
  onBranchButtonClick: () => void;
  onCollapsibleExpand: (key: string) => void;
  onFileClick?: (file: FileStatus, from: 'staged' | 'unstaged') => void;
  onCommitButtonClick?: (message: string) => void;
  onFileListActionButtonClick?: (action: 'stage-all' | 'unstage-all') => void;
  onMoreButtonClick?: () => void;
  onOpenFolderButtonClick?: () => void;
  onStartServerButtonClick?: () => void;
}

type HeadStatus = 0 | 1;
type WorkdirStatus = 0 | 1 | 2;
type StageStatus = 0 | 1 | 2 | 3;
type StatusRow = [string, HeadStatus, WorkdirStatus, StageStatus];

type Oid = {
  workdirOid?: string,
  stageOid?: string,
  headOid?: string
}

type StatusResult = {
  files?: FileStatus[],
  staged?: FileStatus[],
  unstaged?: FileStatus[],
  branchSymbol: string,
  totalCount: number,
  stagedCount: number,
  unstagedCount: number
}

type CollectOidsResult = {
  [filepath: string]: Oid
}

declare const app: HTMLBodyElement;
declare const Executor: Executor;

interface Executor {
  execute(command: string, alpine?: boolean): Promise<string>;
  start(command: string, onData: (type: string, data: string) => void, alpine?: boolean);
}