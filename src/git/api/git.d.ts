/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
*/

import { IDisposable } from "../../base/disposable";
import { Event } from "../../base/event";
import { SourceControlCommandAction } from "../../scm/api/sourceControl";

export interface Git {
	readonly path: string;
}

export interface InputBox {
	value: string;
}

export const enum ForcePushMode {
	Force,
	ForceWithLease,
	ForceWithLeaseIfIncludes,
}

export const enum RefType {
	Head,
	RemoteHead,
	Tag
}

export interface Ref {
	readonly type: RefType;
	readonly name?: string;
	readonly commit?: string;
	readonly commitDetails?: Commit;
	readonly remote?: string;
}

export interface UpstreamRef {
	readonly remote: string;
	readonly name: string;
	readonly commit?: string;
}

export interface Branch extends Ref {
	readonly upstream?: UpstreamRef;
	readonly ahead?: number;
	readonly behind?: number;
}

export interface CommitShortStat {
	readonly files: number;
	readonly insertions: number;
	readonly deletions: number;
}

export interface Commit {
	readonly hash: string;
	readonly message: string;
	readonly parents: string[];
	readonly authorDate?: Date;
	readonly authorName?: string;
	readonly authorEmail?: string;
	readonly commitDate?: Date;
	readonly shortStat?: CommitShortStat;
}

export interface Submodule {
	readonly name: string;
	readonly path: string;
	readonly url: string;
}

export interface Remote {
	readonly name: string;
	readonly fetchUrl?: string;
	readonly pushUrl?: string;
	readonly isReadOnly: boolean;
}

export const enum Status {
	INDEX_MODIFIED,
	INDEX_ADDED,
	INDEX_DELETED,
	INDEX_RENAMED,
	INDEX_COPIED,

	MODIFIED,
	DELETED,
	UNTRACKED,
	IGNORED,
	INTENT_TO_ADD,
	INTENT_TO_RENAME,
	TYPE_CHANGED,

	ADDED_BY_US,
	ADDED_BY_THEM,
	DELETED_BY_US,
	DELETED_BY_THEM,
	BOTH_ADDED,
	BOTH_DELETED,
	BOTH_MODIFIED
}

export interface Change {
	readonly uri: string;
	readonly originalUri: string;
	readonly renameUri: string | undefined;
	readonly status: Status;
}

export interface RepositoryState {
	readonly HEAD: Branch | undefined;
	readonly remotes: Remote[];
	readonly submodules: Submodule[];
	readonly rebaseCommit: Commit | undefined;

	readonly mergeChanges: Change[];
	readonly indexChanges: Change[];
	readonly workingTreeChanges: Change[];
	readonly untrackedChanges: Change[];

	readonly onDidChange: Event<void>;
}

export interface RepositoryUIState {
	readonly selected: boolean;
	readonly onDidChange: Event<void>;
}

/**
 * Log options.
 */
export interface LogOptions {
	/** Max number of log entries to retrieve. If not specified, the default is 32. */
	readonly maxEntries?: number;
	readonly path?: string;
	/** A commit range, such as "0a47c67f0fb52dd11562af48658bc1dff1d75a38..0bb4bdea78e1db44d728fd6894720071e303304f" */
	readonly range?: string;
	readonly reverse?: boolean;
	readonly sortByAuthorDate?: boolean;
	readonly shortStats?: boolean;
	readonly author?: string;
	readonly grep?: string;
	readonly refNames?: string[];
	readonly maxParents?: number;
	readonly skip?: number;
}

export interface CommitOptions {
	all?: boolean | 'tracked';
	amend?: boolean;
	signoff?: boolean;
	signCommit?: boolean;
	empty?: boolean;
	noVerify?: boolean;
	requireUserConfig?: boolean;
	useEditor?: boolean;
	verbose?: boolean;
}

export interface FetchOptions {
	remote?: string;
	ref?: string;
	all?: boolean;
	prune?: boolean;
	depth?: number;
}

export interface InitOptions {
	defaultBranch?: string;
}

export interface RefQuery {
	readonly contains?: string;
	readonly count?: number;
	readonly pattern?: string | string[];
	readonly sort?: 'alphabetically' | 'committerdate';
}

export interface BranchQuery extends RefQuery {
	readonly remote?: boolean;
}

export interface Repository {

	readonly rootUri: string;
	readonly inputBox: InputBox;
	readonly state: RepositoryState;
	readonly ui: RepositoryUIState;

	readonly onDidCommit: Event<void>;
	readonly onDidCheckout: Event<void>;

	getConfigs(): Promise<{ key: string; value: string; }[]>;
	getConfig(key: string): Promise<string>;
	setConfig(key: string, value: string): Promise<string>;
	unsetConfig(key: string): Promise<string>;
	getGlobalConfig(key: string): Promise<string>;

	getObjectDetails(treeish: string, path: string): Promise<{ mode: string, object: string, size: number }>;
	buffer(ref: string, path: string): Promise<any>;
	getCommit(ref: string): Promise<Commit>;

	add(paths: string[]): Promise<void>;
	revert(paths: string[]): Promise<void>;
	clean(paths: string[]): Promise<void>;

	apply(patch: string, reverse?: boolean): Promise<void>;
	diffWithHEAD(): Promise<Change[]>;
	diffWithHEAD(path: string): Promise<string>;
	diffIndexWithHEAD(): Promise<Change[]>;
	diffIndexWithHEAD(path: string): Promise<string>;

	createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
	deleteBranch(name: string, force?: boolean): Promise<void>;
	getBranch(name: string): Promise<Branch>;
	getBranches(query: BranchQuery): Promise<Ref[]>;
	setBranchUpstream(name: string, upstream: string): Promise<void>;

	checkIgnore(paths: string[]): Promise<Set<string>>;

	getRefs(query: RefQuery): Promise<Ref[]>;

	tag(name: string, upstream: string): Promise<void>;
	deleteTag(name: string): Promise<void>;

	status(): Promise<void>;
	checkout(treeish: string): Promise<void>;

	addRemote(name: string, url: string): Promise<void>;
	removeRemote(name: string): Promise<void>;
	renameRemote(name: string, newName: string): Promise<void>;

	fetch(options?: FetchOptions): Promise<void>;
	fetch(remote?: string, ref?: string, depth?: number): Promise<void>;
	pull(unshallow?: boolean): Promise<void>;
	push(remoteName?: string, branchName?: string, setUpstream?: boolean, force?: ForcePushMode): Promise<void>;

	log(options?: LogOptions): Promise<Commit[]>;

	commit(message: string, opts?: CommitOptions): Promise<void>;
	merge(ref: string): Promise<void>;
	mergeAbort(): Promise<void>;
}

export interface RemoteSource {
	readonly name: string;
	readonly description?: string;
	readonly detail?: string;
	readonly icon?: string;
	readonly url: string | string[];
}

export interface RemoteSourceProvider {
	readonly name: string;
	readonly icon?: string;
	readonly placeholder?: string;
	readonly supportsQuery?: boolean;
	getRemoteSources(query?: string): Promise<RemoteSource[]>;
	publishRepository?(repository: Repository): Promise<void>;
}

export interface PickRemoteSourceOptions {
	readonly providerLabel?: (provider: RemoteSourceProvider) => string;
	readonly urlLabel?: string;
}

export interface RemoteSourcePublisher {
	readonly name: string;
	readonly icon?: string;
	publishRepository(repository: Repository): Promise<void>;
}

export interface Credentials {
	readonly username: string;
	readonly password: string;
}

export interface CredentialsProvider {
	getCredentials(host: string): Promise<Credentials | undefined>;
}

export interface PushErrorHandler {
	handlePushError(repository: Repository, remote: Remote, refspec: string, error: Error & { gitErrorCode: GitErrorCodes }): Promise<boolean>;
}

export interface PostCommitCommandsProvider {
	getCommands(repository: Repository): SourceControlCommandAction[];
}

export interface AvatarQueryCommit {
	readonly hash: string;
	readonly authorName?: string;
	readonly authorEmail?: string;
}

export interface AvatarQuery {
	readonly commits: AvatarQueryCommit[];
	readonly size: number;
}

export type APIState = 'uninitialized' | 'initialized';

export interface PublishEvent {
	repository: Repository;
	branch?: string;
}

export interface API {
	readonly state: APIState;
	readonly onDidChangeState: Event<APIState>;
	readonly onDidPublish: Event<PublishEvent>;
	readonly git: Git;
	readonly repositories: Repository[];
	readonly onDidOpenRepository: Event<Repository>;
	readonly onDidCloseRepository: Event<Repository>;

	toGitUri(uri: string, ref: string): string;
	getRepository(uri: string): Repository | null;
	getRepositoryRoot(uri: string): Promise<string | null>;
	init(root: string, options?: InitOptions): Promise<Repository | null>;
	openRepository(root: string): Promise<Repository | null>;
	registerRemoteSourcePublisher(publisher: RemoteSourcePublisher): IDisposable;
	registerRemoteSourceProvider(provider: RemoteSourceProvider): IDisposable;
	registerCredentialsProvider(provider: CredentialsProvider): IDisposable;
	registerPushErrorHandler(handler: PushErrorHandler): IDisposable;
	pickRemoteSource(options: PickRemoteSourceOptions): Promise<string | undefined>;
}

export interface GitExtension {
	readonly enabled: boolean;
	readonly onDidChangeEnablement: Event<boolean>;
	getAPI(version: 1): API;
}

export const enum GitErrorCodes {
	BadConfigFile = 'BadConfigFile',
	BadRevision = 'BadRevision',
	AuthenticationFailed = 'AuthenticationFailed',
	NoUserNameConfigured = 'NoUserNameConfigured',
	NoUserEmailConfigured = 'NoUserEmailConfigured',
	NoRemoteRepositorySpecified = 'NoRemoteRepositorySpecified',
	NotAGitRepository = 'NotAGitRepository',
	NotASafeGitRepository = 'NotASafeGitRepository',
	NotAtRepositoryRoot = 'NotAtRepositoryRoot',
	Conflict = 'Conflict',
	StashConflict = 'StashConflict',
	UnmergedChanges = 'UnmergedChanges',
	PushRejected = 'PushRejected',
	ForcePushWithLeaseRejected = 'ForcePushWithLeaseRejected',
	ForcePushWithLeaseIfIncludesRejected = 'ForcePushWithLeaseIfIncludesRejected',
	RemoteConnectionError = 'RemoteConnectionError',
	DirtyWorkTree = 'DirtyWorkTree',
	CantOpenResource = 'CantOpenResource',
	GitNotFound = 'GitNotFound',
	CantCreatePipe = 'CantCreatePipe',
	PermissionDenied = 'PermissionDenied',
	CantAccessRemote = 'CantAccessRemote',
	RepositoryNotFound = 'RepositoryNotFound',
	RepositoryIsLocked = 'RepositoryIsLocked',
	BranchNotFullyMerged = 'BranchNotFullyMerged',
	NoRemoteReference = 'NoRemoteReference',
	InvalidBranchName = 'InvalidBranchName',
	BranchAlreadyExists = 'BranchAlreadyExists',
	NoLocalChanges = 'NoLocalChanges',
	NoStashFound = 'NoStashFound',
	LocalChangesOverwritten = 'LocalChangesOverwritten',
	NoUpstreamBranch = 'NoUpstreamBranch',
	IsInSubmodule = 'IsInSubmodule',
	WrongCase = 'WrongCase',
	CantLockRef = 'CantLockRef',
	CantRebaseMultipleBranches = 'CantRebaseMultipleBranches',
	PatchDoesNotApply = 'PatchDoesNotApply',
	NoPathFound = 'NoPathFound',
	UnknownPath = 'UnknownPath',
	EmptyCommitMessage = 'EmptyCommitMessage',
	BranchFastForwardRejected = 'BranchFastForwardRejected',
	BranchNotYetBorn = 'BranchNotYetBorn',
	TagConflict = 'TagConflict',
	CherryPickEmpty = 'CherryPickEmpty',
	CherryPickConflict = 'CherryPickConflict',
	WorktreeContainsChanges = 'WorktreeContainsChanges',
	WorktreeAlreadyExists = 'WorktreeAlreadyExists',
	WorktreeBranchAlreadyUsed = 'WorktreeBranchAlreadyUsed'
}