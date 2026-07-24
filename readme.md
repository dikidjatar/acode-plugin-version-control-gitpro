<div align="center">

# Acode Plugin Git SCM

![Version](https://img.shields.io/badge/version-2.9.2-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Acode](https://img.shields.io/badge/Acode-Compatible-orange.svg)

**Professional Git integration for Acode Editor**

[Features](#features) • [Installation](#installation) • [Requirements](#requirements) • [API](#api) • [Contributing](#contributing)

</div>

**Git SCM v2** is a complete rewrite that communicates directly with the native Git binary installed on your system, providing full Git compatibility. This plugin executes real Git commands through Acode's Executor API, ensuring 100% Git compatibility. Unlike JavaScript-based solutions (isomorphic-git), this plugin communicates directly with your system Git installation for full compatibility and optimal performance.

## Screenshoots

<div align="center" style="display: flex; overflow-x: auto; gap: 10px; padding: 10px;">
  <img src="https://raw.githubusercontent.com/dikidjatar/acode-plugin-version-control-gitpro/refs/heads/main/screenshot/1.jpg" alt="Source Control" width="300"/>
  <img src="https://raw.githubusercontent.com/dikidjatar/acode-plugin-version-control-gitpro/refs/heads/main/screenshot/2.jpg" alt="File Tree Decorations" width="300"/>
  <img src="https://raw.githubusercontent.com/dikidjatar/acode-plugin-version-control-gitpro/refs/heads/main/screenshot/3.jpg" alt="Branch Management" width="300"/>
  <img src="https://raw.githubusercontent.com/dikidjatar/acode-plugin-version-control-gitpro/refs/heads/main/screenshot/4.jpg" alt="Git Command" width="300"/>
</div>

## Requirements

**Git** must be installed on your system and Acode latest version with Terminal and Executor API support:

```bash
apk add git
```

### SSH (Required for GitHub / SSH remotes)

> Alpine Linux ships with **Dropbear SSH** by default, which conflicts with OpenSSH and causes Git authentication issues.
> This plugin requires **OpenSSH** for full compatibility.

After installation, generate and configure your SSH keys normally.

## Features

See [Git support in Acode](https://github.com/dikidjatar/acode-plugin-version-control-gitpro/blob/main/docs/overview.md) to learn about the features of this plugin.

## Installation

1. Open **Settings**
2. Select **Plugins**
3. Search for **"Git SCM"**
4. Tap **Install**
5. Restart

### How It Works

The plugin follows a **Shell → Parse → Render** workflow. The same architecture as the VS Code Git extension:

| Stage      | Responsibility                                            |
| ---------- | --------------------------------------------------------- |
| **Shell**  | Execute Git commands via Acode Executor API               |
| **Parse**  | Process stdout/stderr into internal models                |
| **Render** | Display models in UI (resource state, decorations, views) |

---

## API

The Git extension exposes an API, reachable by any other plugin.

#### Git API

Access the Git API in Acode:

1. Copy `src/api/git.d.ts` to your plugin's sources;
2. Include `git.d.ts` in your plugin's compilation.
3. Get a hold of the API with the following snippet:

```javascript
const gitPlugin = acode.require("git");
const gitAPI = gitPlugin.getAPI(1);

// Get repository
const repo = gitAPI.getRepository("/path/to/repositoy");

// repository status
await repo.status();

// Create a branch
await repo.createBranch("feature-branch", true);

// Commit
await repo.commit("Your commit message", { all: true });

// Push to remote
await repo.push("origin", "main");
```

#### SCM API

Access the SCM API:

```javascript
const scm = acode.require("scm");

// Create a source control provider
const sourceControl = scm.createSourceControl("my-scm", "My SCM", "/public");

// Create resource groups
const changes = sourceControl.createResourceGroup("changes", "Changes");

// Add resources
changes.resourceStates = [
  {
    resourceUri: "/path/to/file",
    decorations: {
      strikeThrough: false,
    },
  },
];
```

For a complete API reference see the [API reference documentation](/docs/api-reference.md).

See also type definition files:

- [`git.d.ts`](src/git/api/git.d.ts) - Git API types
- [`sourceControl.d.ts`](src/scm/api/sourceControl.d.ts) - SCM API types

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
- **Email**: dikidjatar@gmail.com

---

<div align="center">

_Happy coding ✨_

</div>
