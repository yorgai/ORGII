import { ROUTES } from "@src/config/routes";

export const ECONOMY_ROOT_PATH = ROUTES.app.market.tokenMarket.path.slice(
  0,
  ROUTES.app.market.tokenMarket.path.lastIndexOf("/")
);

export const ECONOMY_ROUTES = [
  ROUTES.app.market.tokenMarket,
  ROUTES.app.market.agentApps,
  ROUTES.app.market.serviceMarket,
  ROUTES.app.market.agentStudio,
  ROUTES.app.market.wallet,
  ROUTES.app.market.earnings,
  ROUTES.app.market.boost,
  ROUTES.app.market.profile,
  ROUTES.app.market.delegationHistory,
] as const;
