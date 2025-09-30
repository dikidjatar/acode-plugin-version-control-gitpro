let appSettings = {};
let updateFn = null;

const defaultSettings = {
  serverUrl: 'http://localhost:3080',
  autoRefresh: true,
  githubToken: '',
  defaultBranchName: 'master',
  gitConfigUsername: '',
  gitConfigUserEmail: ''
};

function get(key) {
  if (appSettings[key] !== undefined) {
    return appSettings[key];
  }
  return defaultSettings[key];
}

function update(key, value) {
  appSettings[key] = value;
  if (updateFn) {
    updateFn();
  }
}

const settings = {
  default: defaultSettings,

  get serverUrl() {
    return get('serverUrl');
  },

  get autoRefresh() {
    return get('autoRefresh');
  },

  get githubToken() {
    return get('githubToken');
  },

  set githubToken(value) {
    update('githubToken', value);
  },

  get defaultBranchName() {
    return get('defaultBranchName');
  },

  get gitConfigUsername() {
    return get('gitConfigUsername');
  },

  set gitConfigUsername(value) {
    update('gitConfigUsername', value);
  },

  get gitConfigUserEmail() {
    return get('gitConfigUserEmail');
  },

  set gitConfigUserEmail(value) {
    update('gitConfigUserEmail', value);
  },

  initialize(settings, update) {
    appSettings = settings;
    updateFn = update;
  },
  
  getSettingObj() {
    return {
      list: [
        {
          key: 'serverUrl',
          text: 'Git: Server URL',
          info: 'URL of the Git server used by this plugin.',
          value: settings.serverUrl,
          prompt: 'Enter server URL',
          promptType: 'text',
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
        }
      ],
      cb: update
    }
  }
};

export default settings;