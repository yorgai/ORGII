/**
 * FileTab Types
 */

export interface FileTabProps {
  /** Full file path */
  filePath: string;
  /** Whether this tab is active */
  isActive?: boolean;
  /** Show close button */
  showClose?: boolean;
  /** Close callback */
  onClose?: () => void;
  /** Click callback */
  onClick?: () => void;
  /** Optional className */
  className?: string;
}
