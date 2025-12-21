# Acode Plugin Git SCM

<div align="center">

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Acode](https://img.shields.io/badge/Acode-Compatible-orange.svg)


**Professional Git integration for Acode Editor**

[Features](#features) • [Installation](#installation) • [Requirements](#requirements) • [API](#api) • [Contributing](#contributing)

</div>

**Git SCM v2.0.0** is a complete rewrite that communicates directly with the native Git binary installed on your system, providing full Git compatibility. This plugin executes real Git commands through Acode's Executor API, ensuring 100% Git compatibility. Unlike JavaScript-based solutions (isomorphic-git), this plugin communicates directly with your system Git installation for full compatibility and optimal performance.

## Requirements

**Git** must be installed on your system and Acode latest version with Terminal and Executor API support:
   ```bash
   apk add git
   ```

### Optional (Recommended)

**inotify_tools** - For real time, auto refresh:
```bash
apk add inotify-tools
```

After installation, enable in plugin settings **"Git: Use inotifywait"**.

> **info**: Without inotify_tools, the plugin still works but you need to manually refresh to see changes.

---

## Features

### Core Git Operations
- **Repository Management**: Init, Clone, Multi-repository support
- **Staging & Commits**: Stage/unstage files, commit, amend commits, undo commits
- **Branches**: Create, delete, rename, merge, rebase branches
- **Remote Operations**: Pull, push, fetch (with prune), sync (Pull & Push)
- **History**: View commit history
- **Tags & Remotes**: Tag and remote management

### Acode Integration
- **File Decorations**: Visual decoration in SCM panel and file explorer
- **Editor Integration**: Commit message editor opens in Acode (via IPC)
- **Credential Management**: Integrated askpass for authentication
- **Multi-repository**: Work with multiple Git repositories 
- **Status Bar**: Quick sync actions and repository status

## Installation

1. Open **Settings**
2. Select **Plugins**
3. Search for **"Git SCM"**
4. Tap **Install**
5. Restart

### Architecture

The plugin follows a **Shell → Parse → Render** workflow. The same architecture as the VS Code Git extension:

1. **Shell**: Execute Git commands via Acode Executor API
2. **Parse**: Process stdout/stderr into internal models
3. **Render**: Display models in UI (resource state, decorations, views)

This approach mirrors [VSCode Git extension](https://github.com/microsoft/vscode/blob/main/extensions/git).

## API Documentation

### Git API

Access the Git API in Acode:

```javascript
const gitPlugin = acode.require('git');
const gitAPI = gitPlugin.getAPI(1);

// Get repository
const repo = gitAPI.getRepository('/path/to/repositoy');

// repository status
await repo.status();

// Create a branch
await repo.createBranch('feature-branch', true);

// Commit
await repo.commit('Your commit message', { all: true });

// Push to remote
await repo.push('origin', 'main');
```

### SCM API

Access the SCM API:

```javascript
const scm = acode.require('scm');

// Create a source control provider
const sourceControl = scm.createSourceControl('my-scm', 'My SCM', '/public');

// Create resource groups
const changes = sourceControl.createResourceGroup('changes', 'Changes');

// Add resources
changes.resourceStates = [
  {
    resourceUri: '/path/to/file',
    decorations: {
      letter: 'M',
      color: '#ffa500'
    }
  }
];
```

See type definition files:
- [`git.d.ts`](src/git/api/git.d.ts) - Git API types
- [`sourceControl.d.ts`](src/scm/api/sourceControl.d.ts) - SCM API types

For complete API documentation, see [DOCS.md](DOCS.md).

## Customization

### Settings Overview

| Setting | Description | Default |
|---------|-------------|---------|
| `enabled` | Enable/disable Git integration | `true` |
| `useEditorAsCommitInput` | Use Acode editor for commit messages | `true` |
| `useInotifywait` | Enable file system watching | `true` |
| `decorationsEnabled` | Show file decorations | `true` |
| `autorefresh` | Automatically refresh repository status | `true` |
| `autofetch` | Automatically fetch from remote | `true` |
| `autofetchPeriod` | Fetch interval in seconds | `180` |
| `enableSmartCommit` | Commit all changes when nothing staged | `false` |
| `confirmSync` | Confirm before sync operation | `true` |
| `allowForcePush` | Allow force push operations | `false` |

See all available settings in **Settings → Plugins → Git SCM**.

### Command Palette Commands

Press `Ctrl+Shift+P` and type Git:

```
Git: Clone
Git: Init
Git: Pull
Git: Push
Git: Fetch
Git: Sync
Git: Commit
Git: Commit (Amend)
Git: Undo Last Commit
Git: Create Branch
Git: Checkout
Git: Merge Branch
Git: Rebase Branch
Git: Add Remote
Git: Stage All Changes
Git: Unstage All Changes
....
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Credits & Attribution

This project (the Acode Git SCM integration using Executor) is licensed under the MIT License. See the `LICENSE` file.

Parts of this project are derived from or heavily inspired by the Visual Studio Code
project and its Git extension:

- Visual Studio Code — https://github.com/microsoft/vscode  
  Copyright (c) Microsoft Corporation  
  Licensed under the MIT License.

The execution
layer has been reworked to use Acode `Executor` API rather than VS Code's
internal APIs.

## Support & Contact

- **Issues**: [GitHub Issues](https://github.com/dikidjatar/acode-plugin-version-control-gitpro/issues)
- **Discussions**: [GitHub Discussions](https://github.com/dikidjatar/acode-plugin-version-control-gitpro/discussions)
- **Email**: dikidjatar@gmail.com

---

*Happy coding ✨*