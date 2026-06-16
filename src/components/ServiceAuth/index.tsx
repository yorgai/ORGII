/**
 * Service Auth Components
 *
 * UI components for hosted-service authentication.
 * Note: ServiceAuthGuard was removed -- the global AuthGuard in
 * RootLayout already blocks unauthenticated users at the router level.
 */
import Button, { type ButtonVariant } from "@/src/components/Button";
import { LogIn, LogOut } from "lucide-react";
import React from "react";

import { useServiceAuth } from "@src/hooks/auth";

interface ServiceLoginButtonProps {
  className?: string;
  variant?: ButtonVariant;
}

export const ServiceLoginButton: React.FC<ServiceLoginButtonProps> = ({
  className,
  variant = "primary",
}) => {
  const { isAuthenticated, isLoading, login, logout } = useServiceAuth();

  if (isLoading) {
    return (
      <Button variant={variant} className={className} disabled>
        <span className="animate-pulse">Loading...</span>
      </Button>
    );
  }

  if (isAuthenticated) {
    return (
      <Button
        variant="tertiary"
        className={className}
        onClick={() => logout()}
        icon={<LogOut className="h-4 w-4" />}
      >
        Sign out
      </Button>
    );
  }

  return (
    <Button
      variant={variant}
      className={className}
      onClick={login}
      icon={<LogIn className="h-4 w-4" />}
    >
      Sign in
    </Button>
  );
};

export default ServiceLoginButton;
