# Version Control Pro for Acode 🚀

A powerful Version Control Git integration plugin for [Acode Editor](https://acode.app) that brings professional version control features directly to your Android device!.

![Version Control](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-yellow.svg)
![Github](https://img.shields.io/badge/open%20source-grey?style=for-the-badge&logo=github)

## 📸 Screenshots

<div style="display: flex; overflow-x: auto; gap: 10px; padding: 10px;">
  <img src="https://raw.githubusercontent.com/dikidjatar/acode-plugin-version-control-gitpro/refs/heads/main/screenshot/1.jpg" alt="Sidebar Interface" width="300"/>
  <img src="https://raw.githubusercontent.com/dikidjatar/acode-plugin-version-control-gitpro/refs/heads/main/screenshot/2.jpg" width="300"/>
  <img src="https://raw.githubusercontent.com/dikidjatar/acode-plugin-version-control-gitpro/refs/heads/main/screenshot/3.jpg" width="300"/>
  <img src="https://raw.githubusercontent.com/dikidjatar/acode-plugin-version-control-gitpro/refs/heads/main/screenshot/4.jpg" alt="Branch Management" width="300"/>
  <img src="https://raw.githubusercontent.com/dikidjatar/acode-plugin-version-control-gitpro/refs/heads/main/screenshot/5.jpg" alt="Git Status Display" width="300"/>
  <img src="https://raw.githubusercontent.com/dikidjatar/acode-plugin-version-control-gitpro/refs/heads/main/screenshot/6.jpg" alt="Git Status Display" width="300"/>
</div>

## ⚠️ IMPORTANT REQUIREMENTS

### Prerequisites Required BEFORE Installation
This plugin requires **Node.js** and a **Git server** to function properly. The plugin **WILL NOT WORK** without these components.

**Install Git Server:**
```bash
# install server
npm install -g @dikidjatar/git-server

# start server
git-server
```

For complete setup instructions and troubleshooting, visit: [https://github.com/dikidjatar/git-server](https://github.com/dikidjatar/git-server)

### Performance & Project Size
This plugin is **engineered for performance** and **efficiency**:
- ⚡ **Optimized Architecture**: Designed with client-server architecture for maximum speed
- 🎯 **Performance Focused**: Handles projects with **up to 1,500 files** smoothly
- 🚫 **Not Recommended**: For projects with more than 1,500 files (performance may degrade)

Unlike the [previous version control plugin](https://github.com/dikidjatar/acode-plugin-version-control) that used isomorphic-git directly in the browser (which was extremely slow), this plugin uses a dedicated Git server architecture that provides:
- Significantly faster Git operations
- Proper handling of large repositories

## ✨ Features

### 🎯 Core Git Operations
- **Repository Management**: Initialize, clone, and manage Git repositories
- **Branch Operations**: Create, switch, rename, and delete branches
- **Staging & Commits**: Interactive staging area with visual file status
- **Remote Operations**: Push, pull, fetch with authentication support
- **File Management**: Stage/unstage individual files or all changes

### 🎨 Visual Git Integration
- **File Tree Integration**: Git status directly in Acode's file explorer
- **Visual Status Indicators**: Color-coded file status (Modified, Added, Deleted, Untracked adn Ignored)
- **Branch Status Display**: Current branch with change indicators

### 🔧 Advanced Features
- **Commit Templates**: Auto-generated commit messages with file summaries
- **Authentication**: GitHub token support for private repositories
- **Multi-remote Support**: Work with multiple Git remotes
- **Amend Commits**: Modify your last commit easily

## 📱 Installation

### Option 1: From Acode
1. Open Acode Editor on your Android device
2. Go to **Settings** → **Plugins**
3. Search for "Version Control Pro"
4. Install and restart Acode

### Option 2: Build from Source
```bash
git clone https://github.com/dikidjatar/acode-plugin-version-control-gitpro
cd acode-plugin-version-control-gitpro
yarn install
yarn build
```

Then install the generated `.zip` file manually in Acode.

## 🚀 Quick Start

### Prerequisites
You'll need a Git server running on your device. We recommend using:
- **Termux** with Git server setup
- **Acode Terminal** with built-in Git support

### Initial Setup
1. **Start Git Server**: Make sure your Git server is running (default: `http://localhost:3080`)
2. **Open Project**: Open any folder in Acode
3. **Access Plugin**: Tap the Source Control icon in the sidebar
4. **Initialize or Clone**: Create a new repository or clone an existing one

### Configuration
Configure the plugin in **Settings** → **Plugins** → **Version Control Pro**:

```javascript
{
  serverUrl: "http://localhost:3080",     // Your Git server URL
  autoRefresh: true,                      // Auto-refresh on file changes
  githubToken: "your_token_here",         // For private repos
  defaultBranchName: "main",              // Default branch name
  gitConfigUsername: "Your Name",         // Git user name
  gitConfigUserEmail: "you@example.com"   // Git user email
}
```

## 📖 Usage Guide

### Basic Workflow
1. **Stage Changes** 📝
   - View modified files in the sidebar
   - Click the `+` button to stage all changes
   - Or click individual files to stage selectively

2. **Commit Changes** ✅
   - Write your commit message
   - Click "Commit" button
   - Use commit templates for detailed messages

3. **Sync with Remote** 🌐
   - Pull latest changes: **Menu** → **Pull**
   - Push your commits: **Menu** → **Push**
   - Fetch updates: **Menu** → **Fetch**

### Branch Management
```
Tap branch name → Select operation:
├── Switch to existing branch
├── Create new branch
├── Rename current branch
└── Delete branch
```

### File Operations
- **Stage**: Add file to staging area
- **Unstage**: Remove from staging area
- **Discard**: Revert changes to last commit
- **View HEAD**: See file content from last commit

## 🎛️ Interface Overview

### Sidebar Panel
- **Branch Indicator**: Shows current branch and status symbols
- **Staged Changes**: Files ready for commit
- **Unstaged Changes**: Modified files in working directory
- **Commit Area**: Message input and commit button

### File Tree Integration
- **Status Colors**: Visual indicators for file status
- **Git Symbols**: M (Modified), A (Added), D (Deleted), U (Untracked)

## ⚡ Advanced Usage

### Authentication Setup
For private repositories, set up GitHub token:
```javascript
// In plugin settings
githubToken: "ghp_your_personal_access_token"
```

### Custom Git Server
Configure your own Git server endpoint:
```javascript
// In plugin settings
serverUrl: "http://<host>:<port>"
```

### Commit Message Templates
The plugin generates helpful commit templates:
```
# Please enter the commit message for your changes.
# On branch main
# Changes to be committed:
# modified: src/app.js
# new file: README.md
```

## 🔧 Troubleshooting

### Common Issues

**❌ "Server Unreachable" Error**
- Ensure Git server is running
- Check server URL in settings
- Verify network connectivity

**❌ "No Repository Found" Error**
- Initialize repository: Sidebar → "Initialize Repository"
- Or clone existing repository: Sidebar → "Clone Repository"

**❌ Authentication Failures**
- Verify GitHub token is valid
- Check token permissions (repo access)

**❌ File Tree Not Updating**
- Enable "Auto Refresh" in settings
- Manually refresh: Tap refresh icon in sidebar

### Performance Tips
- Use `.gitignore` to exclude unnecessary files
- Limit repository size for better performance
- Enable auto-refresh for real-time updates

## 🤝 Contributing

We welcome contributions!

### Development Setup
```bash
git clone https://github.com/dikidjatar/acode-plugin-version-control-gitpro
cd acode-plugin-version-control-gitpro
yarn install
yarn dev
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 💝 Support the Project

- ⭐ **Star** this repository
- 🐛 **Report** bugs and suggest features

## 📞 Support & Contact
s
- **Issues**: [GitHub Issues](https://github.com/dikidjatar/acode-plugin-version-control-gitpro/issues)
- **Discussions**: [GitHub Discussions](https://github.com/dikidjatar/acode-plugin-version-control-gitpro/discussions)
- **Email**: dikidjatar@gmail.com

---

*Happy coding ✨*