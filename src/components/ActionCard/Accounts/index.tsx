/**
 * AccountActionCard Component
 *
 * Specialized ActionCard for account-related actions.
 * Provides a consistent interface for code account quick actions.
 *
 * @example
 * ```tsx
 * import { AccountActionCard } from "@src/components/ActionCard/Accounts";
 *
 * <AccountActionCard
 *   title="Set Up Cursor"
 *   description="Connect your account and configure credentials"
 *   onClick={handleSetup}
 *   isPrimary={true}
 * />
 * ```
 */
import React from "react";

import ActionCard from "../index";
import type { AccountActionCardProps } from "./types";

const AccountActionCard: React.FC<AccountActionCardProps> = ({
  title,
  description,
  onClick,
  isPrimary = false,
  disabled = false,
  className = "",
}) => {
  return (
    <ActionCard
      title={title}
      description={description}
      onClick={onClick}
      variant={isPrimary ? "primary" : "default"}
      disabled={disabled}
      className={className}
    />
  );
};

export default AccountActionCard;
