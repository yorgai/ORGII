# Add system preference detection for dark mode

## Requirements

- Detect the user's OS-level dark mode preference using the `prefers-color-scheme` media query
- On first visit (no saved preference), automatically match the system setting
- If the user manually toggles dark mode, their manual choice overrides the system preference
- Listen for system preference changes in real-time (e.g., user changes OS setting while app is open)
- Update the existing DarkMode component from the previous work item

## Acceptance Criteria

1. New users see the app in their OS-preferred color scheme automatically
2. Manual toggle overrides system preference
3. Real-time system preference changes are reflected if user hasn't manually overridden
4. Works correctly on all major browsers (Chrome, Firefox, Safari)
