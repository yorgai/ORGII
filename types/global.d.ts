/**
 * Global TypeScript declarations for the application
 */

// Webpack Hot Module Replacement
interface HotModule {
  accept(callback?: () => void): void;
  addStatusHandler?(callback: (status: string) => void): void;
}

declare const module: {
  hot?: HotModule;
};
