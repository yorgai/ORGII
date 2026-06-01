/**
 * Account-specific ActionCard Types
 */

export interface AccountActionCardProps {
  /**
   * Card title
   */
  title: string;

  /**
   * Card description
   */
  description: string;

  /**
   * Click handler
   */
  onClick: () => void;

  /**
   * Whether this is a primary/recommended action
   * @default false
   */
  isPrimary?: boolean;

  /**
   * Disabled state
   * @default false
   */
  disabled?: boolean;

  /**
   * Additional CSS classes
   */
  className?: string;
}
