# AppUpdater Component

**Status**: ✅ Complete  
**Location**: `src/scaffold/AppUpdater/`  
**Last Updated**: December 26, 2025

---

## Overview

The AppUpdater component provides automatic update checking for Tauri applications. It checks for updates on app startup and periodically, with support for automatic installation and user-initiated updates. Uses Tauri updater plugin for version checking and update installation. Component renders nothing (returns null) - it only handles background update checking.

### Key Features

- ✅ **Automatic Checking**: Check for updates on app startup
- ✅ **Periodic Checking**: Check every hour (60 _ 60 _ 1000ms interval)
- ✅ **Auto Install**: Automatically download and install updates on startup/periodic checks
- ✅ **User Initiated**: User-initiated update checks via exported function
- ✅ **Version Display**: Display current and new versions in dialogs
- ✅ **Update Notifications**: Notify users of available updates via Tauri dialogs
- ✅ **Tauri Integration**: Tauri updater plugin integration
- ✅ **No UI Rendering**: Component returns null, only handles background logic
- ✅ **Browser Detection**: Shows message in browser environment (Tauri-only feature)

---

## Functions

The AppUpdater component serves as:

1. **Update Management**: Manage application updates
2. **Version Checking**: Check for new versions
3. **Update Installation**: Install updates automatically
4. **User Notifications**: Notify users of updates

---

## Where It's Used

### Primary Usage

- Used in main App component
- Automatically checks for updates

```tsx
// Used in App.tsx
import { AppUpdater } from "@src/scaffold/AppUpdater";

function App() {
  return (
    <>
      <AppUpdater />
      {/* App content */}
    </>
  );
}
```

---

## How to Use

### Basic Usage

```tsx
import { AppUpdater, checkForAppUpdates } from "@src/scaffold/AppUpdater";

function App() {
  return (
    <>
      <AppUpdater />
      {/* App content */}
    </>
  );
}

// Manual check
async function handleCheckUpdate() {
  await checkForAppUpdates(true, false);
}
```

### Manual Update Check

```tsx
import { checkForAppUpdates } from "@src/scaffold/AppUpdater";

async function handleManualCheck() {
  // onUserClick=true, autoInstall=false
  await checkForAppUpdates(true, false);
}
```

---

## API Reference

### AppUpdater Component

The component accepts no props and automatically checks for updates.

### checkForAppUpdates Function

```typescript
async function checkForAppUpdates(
  onUserClick?: boolean,
  autoInstall?: boolean
): Promise<void>;
```

**Parameters:**

- `onUserClick` - Whether this is a user-initiated check (default: false)
- `autoInstall` - Whether to automatically install updates (default: false)

---

## Implementation Details

### Automatic Checking

- Checks on app startup (useEffect on mount)
- Checks every hour (60 _ 60 _ 1000ms interval)
- Auto-installs updates by default (autoInstall=true)
- Only runs in Tauri desktop environment

### Update Flow

1. Get current version using `getVersion()` from Tauri app API
2. Check for updates using `check()` from Tauri updater plugin
3. If update available:
   - **Auto-install mode**: Download and install automatically, show info dialog, relaunch app
   - **Manual mode**: Ask user for confirmation via Tauri dialog, download/install if confirmed, relaunch app
4. If no update: Show info message (only if user-initiated)

### Version Display

- Shows current version from `getVersion()`
- Shows new version from update object
- Displays update body/notes in dialog
- Uses Tauri dialog API (`ask`, `message`) for user interaction

### Error Handling

- Catches and logs update errors
- Shows error messages to user via Tauri dialog (only if user-initiated)
- Handles update check failures gracefully
- Browser environment shows Toast message instead

### Tauri Dependencies

- `@tauri-apps/api/app` - getVersion()
- `@tauri-apps/plugin-dialog` - ask(), message() for user dialogs
- `@tauri-apps/plugin-process` - relaunch() for app restart
- `@tauri-apps/plugin-updater` - check() for update checking

### Dependencies

- `@src/components/Toast` - Message component for browser notifications
- `@src/util/tauri` - isTauriDesktop() utility

### Exported Functions

- `checkForAppUpdates(onUserClick?, autoInstall?)` - Main update check function
- `checkForUpdatesManually()` - Convenience function for manual checks

---

## Related Files

- `src/scaffold/AppUpdater/index.tsx` - Main component
- `src/App.tsx` - App component using AppUpdater

---

**Last Updated**: December 26, 2025  
**Status**: ✅ Production Ready (Tauri only)
