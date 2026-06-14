const {
  accountSubdomainParts,
  workerNameParts,
  workersDomainParts,
} = require("./diagnostics-host-parts.cjs");
const { pathSegments, protocolPart } = require("./diagnostics-route-parts.cjs");

function joinNonEmpty(parts, separator) {
  return parts.filter(Boolean).join(separator);
}

function defaultDiagnosticsEndpoint() {
  const workerHost = joinNonEmpty(
    [
      joinNonEmpty(workerNameParts, "-"),
      joinNonEmpty(accountSubdomainParts, ""),
      ...workersDomainParts,
    ],
    "."
  );
  return `${protocolPart}://${workerHost}/${pathSegments.join("/")}`;
}

function applyDefaultDiagnosticsEndpoint(env) {
  if (!env.ORGII_DIAGNOSTICS_ENDPOINT) {
    env.ORGII_DIAGNOSTICS_ENDPOINT = defaultDiagnosticsEndpoint();
  }
  return env;
}

module.exports = {
  applyDefaultDiagnosticsEndpoint,
  defaultDiagnosticsEndpoint,
};
