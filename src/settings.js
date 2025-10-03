const appSettings = acode.require('settings');
const pluginId = 'acode.plugin.version.control.gitpro';

export const DEFAULT_SETTINGS = {
  serverPort: 3080,
  autoRefresh: true,
  githubToken: '',
  defaultBranchName: 'master',
  gitConfigUsername: '',
  gitConfigUserEmail: '',
  gitDecorations: true
};

const settings = {
  get values() { return appSettings.value[pluginId] || DEFAULT_SETTINGS; },

  get serverPort() {
    return this.values.serverPort;
  },

  get autoRefresh() {
    return this.values.autoRefresh;
  },

  get githubToken() {
    return this.values.githubToken;
  },

  set githubToken(value) {
    this.values.githubToken = value;
    appSettings.update();
  },

  get defaultBranchName() {
    return this.values.defaultBranchName;
  },

  get gitConfigUsername() {
    return this.values.gitConfigUsername;
  },

  set gitConfigUsername(value) {
    this.values.gitConfigUsername = value;
    appSettings.update();
  },

  get gitConfigUserEmail() {
    return this.values.gitConfigUserEmail;
  },

  set gitConfigUserEmail(value) {
    this.values.gitConfigUserEmail = value;
    appSettings.update();
  },

  get gitDecorations() {
    return this.values.gitDecorations;
  },

  getSettingObj() {
    return {
      list: [
        {
          key: 'serverPort',
          text: 'Git: Server Port',
          info: 'Port of the Git server used by this plugin.',
          value: settings.serverPort,
          prompt: 'Enter server port',
          promptType: 'number',
          promptOptions: [{ required: true }]
        },
        {
          key: 'autoRefresh',
          text: 'Git: Autorefresh',
          checkbox: settings.autoRefresh
        },
        {
          key: 'githubToken',
          text: 'Git: Github Token',
          info: 'Github token for authentication',
          value: settings.githubToken,
          prompt: 'Github Token',
          promptType: 'text',
          promptOption: [{ require: true }]
        },
        {
          key: 'defaultBranchName',
          text: 'Git: Default Branch Name',
          info: 'The name of the default branch when initializing a new Git repository. When set to empty, the default branc name configurd in Git will be used.',
          value: settings.defaultBranchName,
          prompt: 'Default Branch Name',
          promptType: 'text'
        },
        {
          key: 'gitConfigUsername',
          text: 'Git:Config:User: name',
          info: 'Sets the git config user.name',
          value: settings.gitConfigUsername,
          prompt: 'Enter username',
          promptType: 'text',
          promptOption: [{ require: true }]
        },
        {
          key: 'gitConfigUserEmail',
          text: 'Git:Config:User: email',
          info: 'Sets the git config user.email',
          value: settings.gitConfigUserEmail,
          prompt: 'Enter email',
          promptType: 'email'
        },
        {
          key: 'gitDecorations',
          text: 'Git: Decorations',
          info: 'Show git colors decorations in file explorer',
          checkbox: settings.gitDecorations
        }
      ],
      cb: (key, value) => {
        this.values[key] = value;
        appSettings.update();
      }
    }
  }
};

export default settings;