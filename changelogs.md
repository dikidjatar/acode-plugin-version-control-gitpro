# ChangeLog

## [2.2.4] - 2026-18-02
- Improve file tree decoration
- Fix loss of decoration when folder is expanded/collapsed
- Fixed decoration still shows after commits/discard changes
- Fixed several bugs related to file decoration

## [2.2.3] - 2026-09-02
- Refined UI decorations and styling
- Optimized performance and stability

## [2.2.2] - 2026-29-01
- Optimized performance and stability
- Fixed some bugs

## [2.2.1] - 2026-01-18
- Improved UI
- Add remote source
- Fixed some bugs

## [2.2.0] - 2026-01-05

Features Added:
- Git File System support (git:// URI scheme) for accessing files from any Git ref (branches, tags, commits)
- Diff preview and visualization with file tab decorations
- Complete Git stash management (save, pop, drop, apply)
- New SCM menu items: "Open File (HEAD)", "Show Changes"
- New commands: `git.openChanges`, `git.diff`, `git.openDiff`, `git.stash`
- New settings: `promptToSaveFilesBeforeStash: 'always' | 'staged' | 'never'`, `useCommitInputAsStashMessage`, `openDiffOnClick`
- Extended public Git API with `buffer()`, `getObjectDetails()`, diff methods
- URI conversion utilities: `toGitUri()`, `fromGitUri()`
- Automatic stash handling on checkout with uncommitted changes
- Migrate changes option for branch switching
- Enhanced resource interaction with click-to-open functionality

Bug Fixes:
- Improved URI handling
- **Error handling for checkout operations**: Better error messages and handling for checkout operations with stash/migrate options

## [2.1.2] - 2026-01-01
- Added support for monochrome icon options
- Fixed sync and publish commands
- Updated Acode terminal files path to use dynamic package name
- Fixed incorrect folder name (like ".")

## [2.1.1]

- Fix invalid Android external root folder
- Fixed SCM secondary menu not appearing when git.enabled setting is enabled.

## [2.1.0]

- Added file decoration with Git ignore file
- Fix auto fetch not working
- Added "Open In Integrated" menu in scm menu

## [2.0.0] - 2025-12-21
### Rewrite - Native Git Integration

**This is a major breaking release with a complete architecture!**

Version 2.0.0 represents a fundamental reimplementation of the Git SCM plugin, moving from isomorphic-git to native Git binary integration. This change brings full Git compatibility, improved performance and feature.

### Changes

- **Requires native Git installation**: You must install Git on your system `apk add git`
- **Plugin rewrite**: All internal code has been rewritten
- **Migrated from isomorphic-git to native Git**: All Git operations now use the actual Git binary
- **Settings reset**: Previous plugin settings will not carry over

#### Native Git Integration
- **Real Git binary execution**: Direct communication with system Git via Acode Executor API
- **Full Git compatibility**: 100% compatibility with all Git features and operations

### Migration

If you're upgrading from v1.x:

1. **Uninstall**: Uninstall previous version
2. **Install**: Reinstall the plugin
3. **Install Git**: `apk add git`
4. **Restart**: Required after Git installation

## [1.3.0] - 2025-10-06

### Background Server and URI Handling Improvements
- Changes:
  - Added background server
  - Server can now run in background
  - Added server stop option in menu
  - Fixed invalid URI for Acode SAF uri
  - Optimized code and UI
  - Bug fixes

## [1.2.0] - 2025-10-03

### Improved Server Integration and UI
- Added automatic Git server
  - New start server button for one-click server setup
  - Automated server installation if not present
  - Simplified server management experience
- Enhanced source control UI
  - Fixed scrolling behavior in the Source Control file list so the list scrolls smoothly and doesn't jump when items change.
- Bug fixes

## [1.1.0] - 2025-10-01

### Enhanced Branch UI and Information
- Improved branch information display with more detailed view
- Added local and remote branch status indicators
- Added commit status information (ahead/behind)
- Enhanced branch details with:
  - Author information
  - Latest commit ID (OID)
  - Commit messages
  - Timestamp for each commit
- Better visual organization of branch information
- Improved user experience for branch management

## [1.0.0] - 2025-09-29

This is the first release of Version Control Pro for Acode!