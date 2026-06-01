# Add dark mode toggle to settings page

## Requirements

- Add a toggle switch to the settings page that lets users switch between light and dark mode
- Dark mode should change the color scheme of the entire application
- The user's preference should persist across page reloads
- The backend should store the user's theme preference via an API endpoint
- Colors should use CSS custom properties for easy theming

## Acceptance Criteria

1. A visible toggle in the settings page switches between light/dark
2. Theme changes are applied immediately without page reload
3. Preference is saved to the backend and restored on next visit
4. All text remains readable in both modes
