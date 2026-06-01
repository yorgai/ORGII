# Add application configuration system

## Requirements

- Create a single shared `app.config.ts` file that both frontend and backend import
- Backend settings to include: database URL, API port, JWT secret, rate limit (requests per minute), CORS allowed origins
- Frontend settings to include: theme colors (primary, secondary, background, text), responsive breakpoints, animation duration, API base URL
- Both sets of settings must coexist in the same `app.config.ts` file and be exported together
- Include TypeScript interfaces for all config sections
- Add a `config.test.ts` file that validates all config values have correct types

## Acceptance Criteria

1. Single `app.config.ts` file serves as the source of truth for all settings
2. TypeScript types prevent invalid configuration values at compile time
3. Both frontend and backend settings are properly typed and exported
4. Config test validates all values
