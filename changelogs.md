# ChangeLog

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