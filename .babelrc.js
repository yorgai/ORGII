/**
 * Babel Configuration
 *
 * This file configures Babel, a JavaScript compiler/transpiler.
 *
 * Usage:
 * - Used as a fallback when SLOW_DEV=true is set (see webpack.config.js)
 * - By default, the project uses esbuild-loader for faster builds (10-100x faster)
 * - This config is only active when babel-loader is used instead of esbuild-loader
 *
 * Presets:
 * - @babel/preset-env: Transpiles modern JavaScript to older versions for browser compatibility
 * - @babel/preset-react: Transforms JSX syntax and React code
 *
 * Plugins:
 * - react-refresh/babel: Enables Fast Refresh (hot module replacement) for React components
 *   This allows React components to update without losing state during development
 *
 * Note: In normal development, esbuild-loader is used and this file is ignored.
 * Set SLOW_DEV=true to use Babel instead for debugging compatibility issues.
 */

module.exports = {
  presets: ["@babel/preset-env", "@babel/preset-react"],
  plugins: ["react-refresh/babel"],
};
