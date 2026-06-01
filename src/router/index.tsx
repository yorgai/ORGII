import { Outlet, createBrowserRouter } from "react-router-dom";

import { ViewModeSync } from "@src/components/System";
import { useDeepLinkHandler } from "@src/hooks/platform/useDeepLinkHandler";
import AppShell from "@src/modules";
import ErrorPage from "@src/modules/shared/Error";
import {
  appStandaloneRouteGroup,
  mainAppRouteGroup,
  projectManagerRouteGroup,
  windowRouteGroup,
  workStationRouteGroup,
} from "@src/router/routes/routeGroups";
import { RouteDebugModal } from "@src/scaffold/ModalSystem/variants/RouteDebug";

import { AuthGuard, AuthRedirect } from "./guards";

// Root layout component that includes ViewModeSync and global modals
const RootLayout = () => {
  // Handle deep links (yorgai://) for OAuth callbacks in Tauri production
  useDeepLinkHandler();

  return (
    <>
      <ViewModeSync />
      <RouteDebugModal />
      {/* AuthGuard wraps Outlet - if not authenticated, redirects to login */}
      <AuthGuard>
        <Outlet />
      </AuthGuard>
    </>
  );
};

const router = createBrowserRouter(
  [
    {
      path: "/",
      errorElement: <ErrorPage />,
      element: <RootLayout />,
      children: [
        {
          index: true,
          element: <AuthRedirect />,
        },
        {
          path: "orgii",
          errorElement: <ErrorPage />,
          element: (
            <>
              <AppShell />
            </>
          ),
          children: [
            ...workStationRouteGroup,
            ...projectManagerRouteGroup,
            ...appStandaloneRouteGroup,
            mainAppRouteGroup,
            // Catch-all route for 404s
            {
              path: "*",
              element: <ErrorPage />,
            },
          ],
        },
        { ...windowRouteGroup, errorElement: <ErrorPage /> },
        {
          path: "*",
          element: <ErrorPage />,
        },
      ],
    },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
    },
  }
);

export { router };
