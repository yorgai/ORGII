/**
 * Tauri Cargo feature flags by OS.
 */

/**
 * @param {{ semantic?: boolean }} [options]
 * @returns {string[]}
 */
function tauriFeatureList(options = {}) {
  const features = [];
  if (process.env.WEBDRIVER === "1") {
    features.push("webdriver");
  }
  if (options.semantic) {
    features.push("semantic-search");
  }
  return features;
}

/**
 * @param {{ semantic?: boolean }} [options]
 * @returns {string}
 */
function tauriFeatureString(options = {}) {
  return tauriFeatureList(options).join(",");
}

module.exports = { tauriFeatureList, tauriFeatureString };
