import { App } from './base/app';
import { Disposable, IDisposable } from './base/disposable';
import { Event } from './base/event';
import plugin from '../plugin.json';
import { config } from './base/config';
import { GitPluginImpl } from './git/api/plugin';
import { AskPass } from './git/askpass';
import { CommandCenter } from './git/commands';
import { GitDecorations } from './git/decorationProvider';
import { findGit, Git, IGit } from './git/git';
import { GitEditor } from './git/gitEditor';
import { createIPCServer, IIPCServer } from './git/ipc/ipcServer';
import { LogOutputChannel } from './git/logger';
import { Model } from './git/model';
import { joinUrl } from './git/utils';
import { scm, SCMMenuContext, SCMMenuRegistry } from './scm';
import { SourceControlViewContainer } from './scm/api/sourceControl';

const fs = acode.require('fs');
const Url = acode.require('Url');

const ALPINE_HOME = `/data/user/0/${window.BuildInfo.packageName}/files/alpine/home`;

const disposables: IDisposable[] = [];

const defaultGitConfig: IGitConfig = {
	enabled: true,
	defaultBranchName: 'master',
	ignoreSubmodules: false,
	openAfterClone: 'prompt',
	similarityThreshold: 50,
	statusLimit: 200,
	untrackedChanges: 'mixed',
	commandsToLog: [],
	alwaysShowStagedChangesResourceGroup: false,
	autoRepositoryDetection: true,
	repositoryScanMaxDepth: 1,
	repositoryScanIgnoredFolders: ['node_modules'],
	ignoreLegacyWarning: false,
	ignoreMissingGitWarning: false,
	branchWhitespaceChar: '-',
	showCommitInput: true,
	autorefresh: true,
	showProgress: true,
	ignoreLimitWarning: false,
	enableStatusBarSync: true,
	commitShortHashLength: 7,
	checkoutType: 'all',
	showReferenceDetails: true,
	branchSortOrder: 'committerdate',
	pullBeforeCheckout: false,
	branchPrefix: '',
	branchValidationRegex: '',
	pruneOnFetch: false,
	enableSmartCommit: false,
	smartCommitChanges: 'all',
	suggestSmartCommit: true,
	useEditorAsCommitInput: true,
	promptToSaveFilesBeforeCommit: 'always',
	verboseCommit: false,
	allowNoVerifyCommit: false,
	confirmNoVerifyCommit: true,
	requireGitUserConfig: true,
	confirmEmptyCommits: true,
	autoStash: false,
	fetchOnPull: false,
	pullTags: true,
	ignoreRebaseWarning: false,
	replaceTagsWhenPull: false,
	allowForcePush: false,
	useForcePushWithLease: true,
	useForcePushIfIncludes: true,
	confirmForcePush: true,
	rebaseWhenSync: false,
	confirmSync: true,
	followTagsWhenSync: false,
	useIntegratedAskPass: true,
	autofetch: true,
	autofetchPeriod: 180,
	detectSubmodules: true,
	detectSubmodulesLimit: 10,
	useInotifywait: true,
	decorationsEnabled: true
}

async function destroy() {
	Disposable.dispose(disposables);
}

async function findShell(logger?: LogOutputChannel): Promise<string | undefined> {
	const find = async (shell: string) => {
		try {
			const result = await Executor.execute(`which ${shell}`, true);
			return result.trim();
		} catch (err) {
			logger?.error(`Find ${shell} error: ${err}`);
			return undefined;
		}
	}

	let result = await find('bash');
	if (!result) {
		result = await find('sh');
	}

	return result;
}

async function createModel(logger: LogOutputChannel, disposables: IDisposable[]): Promise<Model> {
	const shell = await findShell(logger);
	const info = await findGit();

	logger.info(`[main] Using git "${info.version}" from "${info.path}"`);

	const rootPath = Url.join(ALPINE_HOME, '.vcgit');

	let ipcServer: IIPCServer | undefined = undefined;
	try {
		ipcServer = await createIPCServer(rootPath, logger);
		disposables.push(ipcServer);
	} catch (err) {
		logger.error(`[main] Failed to create git IPC: ${err}`);
	}

	const askpass = new AskPass(rootPath, ipcServer, logger);
	const gitEditor = new GitEditor(rootPath, ipcServer, logger);
	await askpass.setupScripts();
	await gitEditor.setupScript();
	disposables.push(askpass);
	disposables.push(gitEditor);

	const environment = { ...askpass.getEnv(), ...gitEditor.getEnv(), ...ipcServer?.getEnv() };

	const git = new Git({
		gitPath: info.path,
		version: info.version,
		shell: shell,
		env: environment
	});
	const model = new Model(git, askpass, logger);
	disposables.push(model);

	const onRepository = () => App.setContext('gitOpenRepositoryCount', model.repositories.length);
	model.onDidOpenRepository(onRepository, null, disposables);
	model.onDidCloseRepository(onRepository, null, disposables);
	onRepository();

	git.onOutput((str) => {
		const lines = str.split(/\r?\n/mg);

		while (/^\s*$/.test(lines[lines.length - 1])) {
			lines.pop();
		}

		logger.info(lines.join('\n'));
	}, git, disposables);

	disposables.push(new CommandCenter(git, model, logger));
	disposables.push(new GitDecorations(model));

	checkGitVersion(info);

	return model;
}

async function isGitRepository(folder: Acode.Folder): Promise<boolean> {
	const dotGit = joinUrl(folder.url, '.git');

	try {
		const dotGitStat = await fs(dotGit).stat();
		return dotGitStat.isDirectory;
	} catch (e) {
		return false;
	}
}

async function warnAboutMissingGit(): Promise<void> {
	const gitConfig = config.get('vcgit');
	const shouldIgnore = gitConfig?.ignoreMissingGitWarning === true;

	if (shouldIgnore) {
		return;
	}

	if (!addedFolder.length) {
		return;
	}

	const areGitRepositories = await Promise.all(addedFolder.map(isGitRepository));

	if (areGitRepositories.every(isGitRepository => !isGitRepository)) {
		return;
	}

	acode.pushNotification(
		'Git Not Found',
		'Git not found. Install it or configure it using the "git.path" setting.',
		{
			type: 'warning',
			autoClose: false
		}
	);
}

async function setupDirectory() {
	const homeFs = fs(`file://${ALPINE_HOME}`);
	const vcgitFs = fs(`file://${ALPINE_HOME}/.vcgit`);
	if (!await vcgitFs.exists()) {
		await homeFs.createDirectory('.vcgit');
	}
}

async function initialize(baseUrl: string, options: Acode.PluginInitOptions): Promise<GitPluginImpl> {
	disposables.push(await scm.initialize(baseUrl));
	await config.init('vcgit', defaultGitConfig);
	disposables.push(config);

	acode.addIcon('branch', baseUrl + 'assets/branch.svg');
	acode.addIcon('sync', baseUrl + 'assets/sync.svg');
	acode.addIcon('cloud-upload', baseUrl + 'assets/cloud-upload.svg');
	acode.addIcon('debug-disconnect', baseUrl + 'assets/debug-disconnect.svg');
	acode.addIcon('tag', baseUrl + 'assets/tag.svg');
	acode.addIcon('loading', baseUrl + 'assets/loading.svg');
	acode.addIcon('git-commit', baseUrl + 'assets/git-commit.svg');
	const styles = tag('link', { rel: 'stylesheet', href: baseUrl + 'main.css' });
	document.head.appendChild(styles);
	disposables.push(Disposable.toDisposable(() => styles.remove()));

	await setupDirectory();

	const scmViewContainer = scm.getViewContainer();
	initializeViews(scmViewContainer);

	if (!await Terminal.isInstalled()) {
		//TODO:
	}

	const logger = new LogOutputChannel('Git');
	disposables.push(logger);

	const gitConfig = config.get('vcgit');
	const enabled = gitConfig!.enabled;

	if (!enabled) {
		const onConfigChange = Event.filter(config.onDidChangeConfiguration, e => e.affectsConfiguration('vcgit'));
		const onEnabled = Event.filter(onConfigChange, () => config.get('vcgit')?.enabled === true);
		const result = new GitPluginImpl();
		Event.toPromise(onEnabled).then(async () => result.model = await createModel(logger, disposables));
		return result;
	}

	try {
		const model = await createModel(logger, disposables);
		initializeMenus(logger);
		return new GitPluginImpl(model);
	} catch (err: any) {
		console.warn(err.message);
		logger.warn(`[main] Failed to create model: ${err}`);

		if (!/Git installation not found/.test(err.message || '')) {
			throw err;
		}

		App.setContext('git.missing', true);
		warnAboutMissingGit();

		return new GitPluginImpl();
	} finally {
		if (options.firstInit) {
			acode.alert('WARNING', 'Need restart to take full effect');
		}
	}
}

function checkGitVersion(info: IGit): void {
	if (!/^2\.(25|26)\./.test(info.version)) {
		return;
	}

	const gitConfig = config.get('vcgit');
	const shouldIgnore = gitConfig?.ignoreLegacyWarning;

	if (shouldIgnore === true) {
		return;
	}

	if (!/^[01]/.test(info.version)) {
		return;
	}

	acode.pushNotification(
		'Update Git',
		`You seem to have git "${info.version}" installed. Code works best with git >= 2`,
		{
			type: 'warning',
			autoClose: false
		}
	);
}

function initializeViews(scmViewContainer: SourceControlViewContainer): void {
	scmViewContainer.registerViewWelcomeContent({
		content: 'If you would like to use Git features, please enable Git in your [settings](setting:plugin-acode.plugin.version.control.gitpro?%5B%22enabled%22%5D)',
		when: () => config.get('vcgit')?.enabled === false
	});

	scmViewContainer.registerViewWelcomeContent({
		content: 'In order to use Git features, you can open a folder containing a Git repository or clone from a URL.\n[Open Folder](command:openFolder)\n[Clone Repository](command:git.cloneRecursive)\nTo learn more about how to use Git and source control in Acode [read our docs](https://github.com/dikidjatar/acode-plugin-version-control-gitpro#README).',
		when: () => config.get('vcgit')?.enabled === true
			&& !App.getContext<boolean>('git.missing')
			&& App.getContext<number>('addedFolderCount', addedFolder.length) === 0
			&& App.getContext<number>('git.closedRepositoryCount') === 0
	});

	scmViewContainer.registerViewWelcomeContent({
		content: 'Scaning folder for Git repositories...',
		when: () => config.get('vcgit')?.enabled === true
			&& !App.getContext<boolean>('git.missing')
			&& App.getContext<number>('addedFolderCount', addedFolder.length) !== 0
			&& App.getContext<'initialized' | 'uninitialized'>('git.state') !== 'initialized'
	});

	scmViewContainer.registerViewWelcomeContent({
		content: 'Install Git, a popular source control system, to track code changes and collaborate with others. Learn more in our [Git guides](https://github.com/dikidjatar/acode-plugin-version-control-gitpro#README).',
		when: () => config.get('vcgit')?.enabled === true && App.getContext<boolean>('git.missing') === true
	});

	scmViewContainer.registerViewWelcomeContent({
		content: "The folder currently open doesn't have a Git repository. You can initialize a repository which will enable source control features powered by Git.\n[Initialize Repository](command:git.init?%5Btrue%5D)\nTo learn more about how to use Git and source control in Acode [read our docs](https://github.com/dikidjatar/acode-plugin-version-control-gitpro#README).",
		when: () => config.get('vcgit')?.enabled === true
			&& !App.getContext<boolean>('git.missing')
			&& App.getContext<'initialized' | 'uninitialized'>('git.state') === 'initialized'
			&& App.getContext<number>('addedFolderCount', addedFolder.length) !== 0
			&& App.getContext<number>('scm.providerCount') === 0 && App.getContext<number>('git.closedRepositoryCount') === 0
	});

	scmViewContainer.registerViewWelcomeContent({
		content: 'A Git repository was found that was previously closed.\n[Reopen Closed Repository](command:git.reopenClosedRepositories)\nTo learn more about how to use Git and source control in Acode [read our docs](https://github.com/dikidjatar/acode-plugin-version-control-gitpro#README).',
		when: () => config.get('vcgit')?.enabled === true
			&& !App.getContext<boolean>('git.missing')
			&& App.getContext<'initialized' | 'uninitialized'>('git.state') === 'initialized'
			&& App.getContext<number>('git.closedRepositoryCount', 0) === 1
	});

	scmViewContainer.registerViewWelcomeContent({
		content: 'Git repositories were found that were previously closed.\n[Reopen Closed Repositories](command:git.reopenClosedRepositories)\nTo learn more about how to use Git and source control in Acode [read our docs](https://github.com/dikidjatar/acode-plugin-version-control-gitpro#README).',
		when: () => config.get('vcgit')?.enabled === true
			&& !App.getContext<boolean>('git.missing')
			&& App.getContext<'initialized' | 'uninitialized'>('git.state') === 'initialized'
			&& App.getContext<number>('git.closedRepositoryCount', 0) > 1
	});
}

function initializeMenus(logger: LogOutputChannel): void {
	// Repository context
	SCMMenuRegistry.registerMenuItems('scm/sourceControl', [
		{
			command: { id: 'git.close', title: 'Close Repository' },
			group: '1_header@1',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.closeOtherRepositories', title: 'Close Other Repositories' },
			group: '1_header@2',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && App.getContext<number>('gitOpenRepositoryCount', 0) > 1
		}
	]);

	// Repository menu
	SCMMenuRegistry.registerMenuItems('scm/repository/menu', [
		{
			command: { id: 'git.refresh', title: '<span class="icon refresh"></span>' },
			group: 'navigation',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.pull', title: 'Pull' },
			group: '1_header@1',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.push', title: 'Push' },
			group: '1_header@2',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.clone', title: 'Clone' },
			group: '1_header@3',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.checkout', title: 'Checkout to...' },
			group: '1_header@4',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.fetch', title: 'Fetch' },
			group: '1_header@5',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.commit', title: 'Commit' },
			group: '2_main@1',
			submenu: true,
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git'
		},
		{
			command: { id: 'git.pullpush', title: 'Pull, Push' },
			group: '2_main@2',
			submenu: true,
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git'
		},
		{
			command: { id: 'git.branch', title: 'Branch' },
			group: '2_main@3',
			submenu: true,
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git'
		},
		{
			command: { id: 'git.remotes', title: 'Remote' },
			group: '2_main@4',
			submenu: true,
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git'
		},
		{
			command: { id: 'git.tags', title: 'Tags' },
			group: '2_main@5',
			submenu: true,
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git'
		},
		{
			command: { id: 'git.showOutput', title: 'Show Git Output' },
			group: '3_footer@1',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git'
		},
		{
			command: { id: 'git.closeGitOutput', title: 'Close Git Output' },
			group: '3_footer@2',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && logger.isVisible()
		},
	]);

	// Resource Group
	SCMMenuRegistry.registerMenuItems('scm/resourceGroup/context', [
		{
			command: { id: 'git.stageAllMerge', title: 'Stage All Merge Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'merge',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.unstageAll', title: 'Unstage All Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'index',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.stageAll', title: 'Stage All Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'workingTree' && config.get('vcgit')!.untrackedChanges === 'mixed',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.cleanAll', title: 'Discard All Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'workingTree' && config.get('vcgit')!.untrackedChanges === 'mixed',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.stageAllTracked', title: 'Stage All Tracked Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'workingTree' && config.get('vcgit')!.untrackedChanges !== 'mixed',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.cleanAllTracked', title: 'Discard All Tracked Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'workingTree' && config.get('vcgit')!.untrackedChanges !== 'mixed',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.cleanAllUntracked', title: 'Discard All Untracked Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'untracked',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.stageAllUntracked', title: 'Stage All Untracked Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'untracked',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		}
	]);

	// Resource States
	SCMMenuRegistry.registerMenuItems('scm/resourceState/context', [
		{
			command: { id: 'git.stage', title: 'Stage Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'merge',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.stage', title: 'Stage Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'workingTree',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.stage', title: 'Stage Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'untracked',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.unstage', title: 'Unstage Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'index',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.openFile', title: 'Open File' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'merge',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.openFile', title: 'Open File' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'index'
		},
		{
			command: { id: 'git.openFile', title: 'Open File' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'workingTree'
		},
		{
			command: { id: 'git.openFile', title: 'Open File' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'untracked'
		},
		{
			command: { id: 'git.clean', title: 'Discard Change' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'workingTree',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.clean', title: 'Discard Changes' },
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'untracked',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
	]);

	SCMMenuRegistry.registerMenuItems('scm/resourceFolder/context', [
		{
			command: { id: 'git.stage', title: 'Stage Changes' },
			group: '1_modification',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'merge'
		},
		{
			command: { id: 'git.unstage', title: 'Unstage Changes' },
			group: '1_modification',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'index'
		},
		{
			command: { id: 'git.stage', title: 'Stage Changes' },
			group: '1_modification',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'workingTree'
		},
		{
			command: { id: 'git.clean', title: 'Discard Changes' },
			group: '1_modification',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'workingTree'
		},
		{
			command: { id: 'git.stage', title: 'Stage Changes' },
			group: '1_modification',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'untracked'
		},
		{
			command: { id: 'git.clean', title: 'Discard Changes' },
			group: '1_modification',
			when: (ctx: SCMMenuContext) => ctx.scmProvider === 'git' && ctx.scmResourceGroup === 'untracked'
		},
	]);

	// Commit
	SCMMenuRegistry.registerMenuItems('git.commit', [
		{
			command: { id: 'git.commit', title: 'Commit' },
			group: '1_commit@1',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.commitStaged', title: 'Commit Staged' },
			group: '1_commit@2',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.commitAll', title: 'Commit All' },
			group: '1_commit@3',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.undoCommit', title: 'Undo Last Commit' },
			group: '1_commit@4',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.commitNoVerify', title: 'Commit (No Verify)' },
			group: '2_commit_noverify@1',
			when: () => config.get('vcgit')?.allowNoVerifyCommit === true,
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.commitStagedNoVerify', title: 'Commit Staged (No Verify)' },
			group: '2_commit_noverify@2',
			when: () => config.get('vcgit')?.allowNoVerifyCommit === true,
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.commitAllNoVerify', title: 'Commit All (No Verify)' },
			group: '2_commit_noverify@3',
			when: () => config.get('vcgit')?.allowNoVerifyCommit === true,
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.commitAmend', title: 'Commit (Amend)' },
			group: '3_amend@1',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.commitStagedAmend', title: 'Commit Staged (Amend)' },
			group: '3_amend@2',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.commitAllAmend', title: 'Commit All (Amend)' },
			group: '3_amend@3',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.commitAmendNoVerify', title: 'Commit (Amend, No Verify)' },
			group: '4_amend_noverify@1',
			when: () => config.get('vcgit')?.allowNoVerifyCommit === true,
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.commitStagedAmendNoVerify', title: 'Commit Staged (Amend, No Verify)' },
			group: '4_amend_noverify@2',
			when: () => config.get('vcgit')?.allowNoVerifyCommit === true,
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.commitAllAmendNoVerify', title: 'Commit All (Amend, No Verify)' },
			group: '4_amend_noverify@3',
			when: () => config.get('vcgit')?.allowNoVerifyCommit === true,
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		}
	]);

	SCMMenuRegistry.registerMenuItems('git.pullpush', [
		{
			command: { id: 'git.sync', title: 'Sync' },
			group: '1_sync@1',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.pull', title: 'Pull' },
			group: '2_pull@1',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.pullRebase', title: 'Pull (Rebase)' },
			group: '2_pull@2',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.pullFrom', title: 'Pull From...' },
			group: '2_pull@3',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.push', title: 'Push.' },
			group: '3_push@1',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.pushTo', title: 'Push To...' },
			group: '3_push@2',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.fetch', title: 'Fetch' },
			group: '4_fetch@1',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.fetchPrune', title: 'Fetch (Prune)' },
			group: '4_fetch@2',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.fetchAll', title: 'Fetch From All Remotes' },
			group: '4_fetch@3',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
	]);

	// Branch
	SCMMenuRegistry.registerMenuItems('git.branch', [
		{
			command: { id: 'git.merge', title: 'Merge...' },
			group: '1_merge@1',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.rebase', title: 'Rebase Branch...' },
			group: '1_merge@2',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.branch', title: 'Create Branch...' },
			group: '2_branch@1',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.branchFrom', title: 'Create Branch From...' },
			group: '2_branch@2',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.renameBranch', title: 'Rename Branch...' },
			group: '3_modify@1',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.deleteBranch', title: 'Delete Branch...' },
			group: '3_modify@2',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.deleteRemoteBranch', title: 'Delete Remote Branch...' },
			group: '3_modify@2',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		}
	]);

	// Remotes
	SCMMenuRegistry.registerMenuItems('git.remotes', [
		{
			command: { id: 'git.addRemote', title: 'Add Remote...' },
			group: 'remote@1',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.removeRemote', title: 'Remove Remote...' },
			group: 'remote@2',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		}
	]);

	SCMMenuRegistry.registerMenuItems('git.tags', [
		{
			command: { id: 'git.createTag', title: 'Create Tag...' },
			group: 'tags@1',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.deleteTag', title: 'Delete Tag...' },
			group: 'tags@2',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		},
		{
			command: { id: 'git.deleteRemoteTag', title: 'Delete Remote Tag...' },
			group: 'tags@3',
			enablement: () => !App.getContext<boolean>('git.operationInProgress')
		}
	]);
}

function gitPluginSettings(): Acode.PluginSettings {
	const configs = config.get('vcgit', defaultGitConfig)!;

	return {
		list: [
			{
				key: 'enabled',
				checkbox: configs.enabled,
				text: 'Git: Enabled',
				info: 'Whether Git is enabled.'
			},
			{
				key: 'defaultBranchName',
				value: configs.defaultBranchName,
				text: 'Git: Default Branch Name',
				info: 'The name of the default branch (example: main, trunk, development) when initializing a new Git repository. When set to empty, the default branch name configured in Git will be used. Note: Requires Git version 2.28.0 or later.',
				prompt: 'Default Branch Name',
				promptType: 'text'
			},
			{
				key: 'openAfterClone',
				value: configs.openAfterClone,
				select: ['prompt', 'always', 'whenNoFolderOpen'],
				text: 'Git: open After Clone',
				info: 'Controls whether to open a repository automatically after cloning.prompt'
			},
			{
				key: 'untrackedChanges',
				value: configs.untrackedChanges,
				select: ['mixed', 'separate', 'hidden'],
				text: 'Git: Untracked Changes',
				info: 'Controls how untracked changes behave.'
			},
			{
				key: 'ignoreSubmodules',
				text: 'Git: Ingnore Submodules',
				checkbox: configs.ignoreSubmodules,
				info: 'Ignore modifications to submodules in the file tree.'
			},
			{
				key: 'statusLimit',
				value: configs.statusLimit,
				text: 'Git: Status Limit',
				info: 'Controls how to limit the number of changes that can be parsed from Git status command. Can be set to 0 for no limit.',
				prompt: 'Status Limit',
				promptType: 'number'
			},
			{
				key: 'similarityThreshold',
				value: configs.similarityThreshold,
				text: 'Git: Similarity Threshold',
				info: "Controls the threshold of the similarity index (the amount of additions/deletions compared to the file's size) for changes in a pair of added/deleted files to be considered a rename. Note: Requires Git version 2.18.0 or later.",
				prompt: 'Similarity Threshold',
				promptType: 'number'
			},
			{
				key: 'commandsToLog',
				value: configs.commandsToLog.join('\n'),
				text: 'Git: Commands To Log',
				info: "List of git commands (ex: commit, push) that would have their stdout logged to the git output. If the git command has a client-side hook configured, the client-side hook's stdout will also be logged to the git output.",
				prompt: 'Commands To Log',
				promptType: 'textarea'
			},
			{
				key: 'alwaysShowStagedChangesResourceGroup',
				checkbox: configs.alwaysShowStagedChangesResourceGroup,
				text: 'Git: Always Show Staged Changes Resource Group',
				info: 'Always show the Staged Changes resource group.'
			},
			{
				key: 'openScmSettings',
				text: 'SCM Settings',
				info: 'Open SCM Settings'
			},
			{
				key: 'autoRepositoryDetection',
				text: 'Git: Auto Repository Detection',
				value: typeof configs.autoRepositoryDetection === 'boolean' ? configs.autoRepositoryDetection ? 'true' : 'false' : configs.autoRepositoryDetection,
				select: ['true', 'false', 'subFolders'],
				info: 'Configures when repositories should be automatically detected.',
			},
			{
				key: 'repositoryScanMaxDepth',
				value: configs.repositoryScanMaxDepth,
				text: 'Git: Repository Scan Max Depth',
				info: 'Controls the depth used when scanning workspace folders for Git repositories when Git: Auto Repository Detection is set to true or subFolders. Can be set to -1 for no limit.',
				prompt: 'Repository Scan Max Depth',
				promptType: 'number'
			},
			{
				key: 'repositoryScanIgnoredFolders',
				value: (configs.repositoryScanIgnoredFolders || []).join('\n'),
				text: 'Git: Repository Scan Ignored Folders',
				info: 'List of folders that are ignored while scanning for Git repositories when Git: Auto Repository Detection is set to true or subFolders.',
				prompt: 'Repository Scan Ignored Folders',
				promptType: 'textarea'
			},
			{
				key: 'ignoreLegacyWarning',
				checkbox: configs.ignoreLegacyWarning,
				text: 'Git: Ignore Legacy Warning',
				info: 'Ignores the legacy Git warning.'
			},
			{
				key: 'ignoreMissingGitWarning',
				checkbox: configs.ignoreMissingGitWarning,
				text: 'Git: Ignore Missing Git Warning',
				info: 'Ignores the warning when Git is missing.'
			},
			{
				key: 'branchWhitespaceChar',
				value: configs.branchWhitespaceChar,
				text: 'Git: Branch Whitespace Char',
				info: 'The character to replace whitespace in new branch names, and to separate segments of a randomly generated branch name.',
				prompt: 'Branch Whitespace Char',
				promptType: 'text'
			},
			{
				key: 'showCommitInput',
				checkbox: configs.showCommitInput,
				text: 'Git: Show Commit Input',
				info: 'Controls whether to show the commit input in the Git source control panel.'
			},
			{
				key: 'autorefresh',
				checkbox: configs.autorefresh,
				text: 'Git: Autorefresh',
				info: 'Whether auto refreshing is enabled.'
			},
			{
				key: 'showProgress',
				checkbox: configs.showProgress,
				text: 'Git: Show Progress',
				info: 'Controls whether Git actions should show progress.'
			},
			{
				key: 'ignoreLimitWarning',
				checkbox: configs.ignoreLimitWarning,
				text: 'Git: Ignore Limit Warning',
				info: 'Ignores the warning when there are too many changes in a repository.'
			},
			{
				key: 'enableStatusBarSync',
				checkbox: configs.enableStatusBarSync,
				text: 'Git: Enable Status Bar Sync',
				info: 'Controls whether the Git Sync command appears in the status bar.'
			},
			{
				key: 'commitShortHashLength',
				value: configs.commitShortHashLength,
				text: 'Git: Commit Short Hash Length',
				info: 'Controls the length of the commit short hash.',
				prompt: 'Commit Short Hash Length',
				promptType: 'number'
			},
			{
				key: 'checkoutType',
				value: configs.checkoutType,
				text: 'Git: Checkout Type',
				info: 'Controls what type of Git refs are listed when running Checkout to....',
				prompt: 'Checkout Type',
				select: ['all', 'local', 'remote', 'tags']
			},
			{
				key: 'showReferenceDetails',
				checkbox: configs.showReferenceDetails,
				text: 'Git: Show Reference Details',
				info: 'Controls whether to show the details of the last commit for Git refs in the checkout, branch, and tag pickers.'
			},
			{
				key: 'branchSortOrder',
				value: configs.branchSortOrder,
				text: 'Git: Branch Sort Order',
				info: 'Controls the sort order for branches.',
				select: ['alphabetically', 'committerdate']
			},
			{
				key: 'pullBeforeCheckout',
				checkbox: configs.pullBeforeCheckout,
				text: 'Git: Pull Before Checkout',
				info: 'Controls whether a branch that does not have outgoing commits is fast-forwarded before it is checked out.'
			},
			{
				key: 'branchPrefix',
				value: configs.branchPrefix,
				text: 'Git: Branch Prefix',
				info: 'Prefix used when creating a new branch.',
				prompt: 'Branch Prefix',
				promptType: 'text'
			},
			{
				key: 'branchValidationRegex',
				value: configs.branchValidationRegex,
				text: 'Git: Branch Validation Regex',
				info: 'A regular expression to validate new branch names.',
				prompt: 'Branch Validation Regex',
				promptType: 'text'
			},
			{
				key: 'pruneOnFetch',
				checkbox: configs.pruneOnFetch,
				text: 'Git: Prune On Fetch',
				info: 'Prune when fetching'
			},
			{
				key: 'enableSmartCommit',
				checkbox: configs.enableSmartCommit,
				text: 'Git: Enable Smart Commit',
				info: 'Commit all changes when there are no staged changes.'
			},
			{
				key: 'smartCommitChanges',
				value: configs.smartCommitChanges,
				text: 'Git: Smart Commit Changes',
				info: 'Control which changes are automatically staged by Smart Commit.',
				select: ['all', 'tracked']
			},
			{
				key: 'suggestSmartCommit',
				checkbox: configs.suggestSmartCommit,
				text: 'Git: Suggest Smart Commit',
				info: 'Suggests to enable smart commit (commit all changes when there are no staged changes).'
			},
			{
				key: 'useEditorAsCommitInput',
				checkbox: configs.useEditorAsCommitInput,
				text: 'Git: Use Editor As Commit Input',
				info: 'Controls whether a full text editor will be used to author commit messages, whenever no message is provided in the commit input box.'
			},
			{
				key: 'promptToSaveFilesBeforeCommit',
				value: configs.promptToSaveFilesBeforeCommit,
				select: ['always', 'staged', 'never'],
				text: 'Git: Prompt To Save File Before Commit',
				info: 'Controls whether Git should check for unsaved files before committing.'
			},
			{
				key: 'verboseCommit',
				checkbox: configs.verboseCommit,
				text: 'Git: Verbose Commit',
				info: 'Enable verbose output when Git: Use Editor As Commit Input is enabled.'
			},
			{
				key: 'allowNoVerifyCommit',
				checkbox: configs.allowNoVerifyCommit,
				text: 'Git: Allow No Verify Commit',
				info: 'Controls whether commits without running pre-commit and commit-msg hooks are allowed.'
			},
			{
				key: 'confirmNoVerifyCommit',
				checkbox: configs.confirmNoVerifyCommit,
				text: 'Git: Confirm No Verify Commit',
				info: 'Controls whether to ask for confirmation before committing without verification.'
			},
			{
				key: 'requireGitUserConfig',
				checkbox: configs.requireGitUserConfig,
				text: 'Git: Require User Git Config',
				info: 'Controls whether to require explicit Git user configuration or allow Git to guess if missing.'
			},
			{
				key: 'confirmEmptyCommits',
				checkbox: configs.confirmEmptyCommits,
				text: 'Git: Confirm Empty Commit',
				info: 'Always confirm the creation of empty commits for the \'Git: Commit Empty\' command.'
			},
			{
				key: 'autoStash',
				checkbox: configs.autoStash,
				text: 'Git: Auto Stash',
				info: 'Stash any changes before pulling and restore them after successful pull.'
			},
			{
				key: 'fetchOnPull',
				checkbox: configs.fetchOnPull,
				text: 'Git: Fetch On Pull',
				info: 'When enabled, fetch all branches when pulling. Otherwise, fetch just the current one.'
			},
			{
				key: 'pullTags',
				checkbox: configs.pullTags,
				text: 'Git: Pull Tags',
				info: 'Fetch all tags when pulling'
			},
			{
				key: 'ignoreRebaseWarning',
				checkbox: configs.ignoreRebaseWarning,
				text: 'Git: Ignore Rebase Warning',
				info: 'Ignores the warning when it looks like the branch might have been rebased when pulling.'
			},
			{
				key: 'replaceTagsWhenPull',
				checkbox: configs.replaceTagsWhenPull,
				text: 'Git: Replace Tags When Pull',
				info: 'Automatically replace the local tags with the remote tags in case of a conflict when running the pull command.'
			},
			{
				key: 'allowForcePush',
				checkbox: configs.allowForcePush,
				text: 'Git: Allow Force Push',
				info: 'Controls whether force push (with or without lease) is enabled.'
			},
			{
				key: 'useForcePushWithLease',
				checkbox: configs.useForcePushWithLease,
				text: 'Git: Use Force Push With Lease',
				info: 'Controls whether force pushing uses the safer force-with-lease variant.'
			},
			{
				key: 'useForcePushIfIncludes',
				checkbox: configs.useForcePushIfIncludes,
				text: 'Git: Use Force Push If Includes',
				info: 'Controls whether force pushing uses the safer force-if-includes variant. Note: This setting requires the Git: Use Force Push With Lease setting to be enabled, and Git version 2.30.0 or later.'
			},
			{
				key: 'confirmForcePush',
				checkbox: configs.confirmForcePush,
				text: 'Git: Confirm Force Push',
				info: 'Controls whether to ask for confirmation before force-pushing.'
			},
			{
				key: 'rebaseWhenSync',
				checkbox: configs.rebaseWhenSync,
				text: 'Git: Rebase When Sync',
				info: 'Force Git to use rebase when running the sync command.'
			},
			{
				key: 'confirmSync',
				checkbox: configs.confirmSync,
				text: 'Git: Confirm Sync',
				info: 'Confirm before synchronizing Git repositories.'
			},
			{
				key: 'followTagsWhenSync',
				checkbox: configs.followTagsWhenSync,
				text: 'Git: Follow Tags When Sync',
				info: 'Push all annotated tags when running the sync command.'
			},
			{
				key: 'useIntegratedAskPass',
				checkbox: configs.useIntegratedAskPass,
				text: 'Git: Use Integrated Ask Pass',
				info: 'Controls whether GIT_ASKPASS should be overwritten to use the integrated version.'
			},
			{
				key: 'autofetch',
				value: typeof configs.autofetch === 'boolean' ? configs.autofetch ? 'true' : 'false' : configs.autofetch,
				select: ['true', 'false', 'all'],
				text: 'Git: Autofetch',
				info: 'When set to true, commits will automatically be fetched from the default remote of the current Git repository. Setting to all will fetch from all remotes.'
			},
			{
				key: 'autofetchPeriod',
				value: configs.autofetchPeriod,
				text: 'Git: Autofetch Period',
				info: 'Duration in seconds between each automatic git fetch, when Git: Autofetch is enabled.',
				prompt: 'Git: Autofetch Period',
				promptType: 'number'
			},
			{
				key: 'detectSubmodules',
				checkbox: configs.detectSubmodules,
				text: 'Git: Detect Submodules',
				info: 'Controls whether to automatically detect Git submodules.'
			},
			{
				key: 'detectSubmodulesLimit',
				value: configs.detectSubmodulesLimit,
				text: 'Git: Detect Submodules Limit',
				info: 'Controls the limit of Git submodules detected.',
				prompt: 'Detect Submodules Limit',
				promptType: 'number'
			},
			{
				key: 'useInotifywait',
				checkbox: configs.useInotifywait,
				text: 'Git: Use inotifywait',
				info: 'Use inotifywait for filesystem watcher'
			},
			{
				key: 'decorationsEnabled',
				checkbox: configs.decorationsEnabled,
				text: 'Git: Decorations',
				info: 'Controls whether Git contributes colors and badges to the Explorer and the Open Editors view.'
			}
		],
		cb(key: string, value: unknown) {
			if (key === 'commandsToLog') {
				value = (value as string).split('\n');
			} else if (key === 'openScmSettings') {
				const appSettings = acode.require('settings');
				const scmSetting = appSettings.uiSettings['scm-settings'];
				if (scmSetting) {
					scmSetting.show();
				}
				return;
			} else if (key === 'repositoryScanIgnoredFolders') {
				value = (value as string).split('\n');
			} else if (key === 'autoRepositoryDetection' || key === 'autofetch') {
				value = value === 'true' ? true : value === 'false' ? false : value;
			}

			const configs = config.get('vcgit', defaultGitConfig)!;
			config.update('vcgit', { ...configs, [key]: value });
		},
	}
}

if (window.acode) {
	acode.setPluginInit(
		plugin.id,
		async (baseUrl: string, page, options) => {
			if (!baseUrl.endsWith('/')) baseUrl += '/';

			//! REMOVE
			document.head.append(tag('style', { textContent: '#sidebar { width: 100%; }' }));
			window.IS_FREE_VERSION = false;
			//! REMOVE

			const git = await initialize(baseUrl, options);
			acode.define('git', git);
		},
		gitPluginSettings()
	);
	acode.setPluginUnmount(plugin.id, () => destroy());
}