# LoginModal Component

**Status**: ✅ Complete  
**Location**: `src/components/LoginModal/`  
**Last Updated**: December 25, 2025

---

## Overview

The LoginModal component provides a login modal interface with OAuth authentication support. It handles authentication flow, user profile creation, and login state management. Supports both Tauri desktop app (with OAuth server) and browser (with redirect) authentication flows.

### Key Features

- ✅ **OAuth Authentication**: OAuth authentication flow via Authing
- ✅ **Tauri Support**: Tauri desktop app support with OAuth server
- ✅ **Browser Support**: Browser fallback with redirect
- ✅ **User Profile**: User profile creation and management
- ✅ **Login State**: Login state management via Jotai atoms
- ✅ **Loading State**: Loading state during authentication
- ✅ **Modal Control**: Modal visibility and fix state control

---

## Functions

The LoginModal component serves as:

1. **Authentication**: Handle user authentication via OAuth
2. **Login Interface**: Provide login UI with branding
3. **OAuth Flow**: Manage OAuth authentication flow (Tauri or browser)
4. **User Management**: Create and manage user profiles after login

---

## Where It's Used

### Primary Usage

- `src/page/Orgii/index.tsx` - Used in main layout (via GlobalModals)
- `src/page/Payment/Prices/index.tsx` - Used in pricing page

```tsx
// Used in main app
import LoginModal from "@src/components/LoginModal";

// Modal visibility controlled by loginModalVisibleAtom
<LoginModal />;
```

---

## How to Use

### Basic Usage

The component uses Jotai atoms for state management, so no props are needed:

```tsx
import { useSetAtom } from "jotai";

import LoginModal from "@src/components/LoginModal";
import { loginModalVisibleAtom } from "@src/store/allAtom";

function MyComponent() {
  const setLoginVisible = useSetAtom(loginModalVisibleAtom);

  return (
    <>
      <button onClick={() => setLoginVisible(true)}>Login</button>
      <LoginModal />
    </>
  );
}
```

---

## API Reference

### Component Props

No props required. Component reads from Jotai atoms:

- `loginModalVisibleAtom` - Controls modal visibility
- `loginModalFixAtom` - Controls if modal can be closed
- `userAtom` - User state

### Atoms

**loginModalVisibleAtom:**

- Type: `Atom<boolean>`
- Controls: Modal visibility

**loginModalFixAtom:**

- Type: `Atom<boolean>`
- Controls: Whether modal can be closed (if true, modal cannot be closed)

**userAtom:**

- Type: `Atom<User | null>`
- Stores: Current user information

---

## Implementation Details

### OAuth Flow

**Tauri Desktop:**

1. Starts OAuth server on port 54031
2. Opens login URL in system browser
3. Listens for OAuth callback URL
4. Extracts authorization code from callback
5. Completes login with code
6. Stops OAuth server

**Browser:**

1. Gets login URL from API
2. Redirects window to login URL
3. User completes login on Authing
4. Redirects back to app

### Authentication Process

1. **Get Login URL**: Calls `getLoginUrl()` API
2. **Start OAuth**:
   - Tauri: Starts OAuth server and opens URL
   - Browser: Redirects to URL
3. **Handle Callback**:
   - Extracts `code` from callback URL
   - Calls `completeLogin({ code })`
4. **Get User Info**: Calls `getCurrentUserInfo()` API
5. **Create Profile**: Calls `createUserProfile()` with user data
6. **Update State**: Updates `userAtom` with user information
7. **Close Modal**: Closes modal after successful login

### Login State Management

- **Session Storage**: Uses `sessionStorage` to track `login_in_progress` flag
- **Prevents Duplicates**: Skips duplicate login requests if already in progress
- **Cleanup**: Clears flag after login completes

### Modal Behavior

- **Visibility**: Controlled by `loginModalVisibleAtom`
- **Closable**: Can be prevented from closing via `loginModalFixAtom`
- **Mask Closable**: `maskClosable={!loginModalFix}`
- **ESC to Exit**: `escToExit={!loginModalFix}`
- **Size**: `h-[500px] w-[400px]`
- **Rounded**: `rounded-xl`

### UI Elements

- **Branding**: Atlas XP logo (`IconAtlasXp`)
- **Title**: "Unlock the power of Atlas XP"
- **Login Button**:
  - Text: "Login in / Sign Up"
  - Size: `h-8 w-[320px]`
  - Loading state during authentication
- **Terms**: Links to Terms of Service and Privacy Policy

### Error Handling

- **OAuth Server**: Tries to stop existing server before starting new one
- **URL Parsing**: Handles errors when parsing callback URL
- **API Errors**: Logs errors but doesn't show user-facing error messages
- **Login In Progress**: Prevents duplicate login attempts

### Dependencies

- `@fabianlars/tauri-plugin-oauth` - OAuth plugin for Tauri
- `@tauri-apps/plugin-opener` - Open URLs in system browser
- `@src/api/loginApi` - getLoginUrl, completeLogin
- `@src/api/userApi` - getCurrentUserInfo, createUserProfile
- `@src/components/Modal` - Modal component
- `@src/components/Button` - Button component
- `@src/store/allAtom` - loginModalVisibleAtom, loginModalFixAtom
- `@src/store/userAtom` - userAtom
- `@src/util/tauri` - isTauriDesktop utility

---

## Related Files

- `src/components/LoginModal/index.tsx` - Main component implementation
- `src/components/LoginModal/index.scss` - Component styles
- `src/api/loginApi.ts` - Login API functions
- `src/api/userApi.ts` - User API functions
- `src/components/TitleBar/callback.template` - OAuth callback HTML template

---

**Last Updated**: December 25, 2025  
**Status**: ✅ Production Ready
