import Button from "@src/components/Button";

export interface SettingsTableLoadMoreFooterProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  noPx?: boolean;
  dataTestId?: string;
}

export function SettingsTableLoadMoreFooter({
  label,
  onClick,
  disabled,
  noPx = false,
  dataTestId,
}: SettingsTableLoadMoreFooterProps) {
  return (
    <div
      className={`flex items-center justify-center py-2 ${noPx ? "px-0" : "px-4"}`}
    >
      <Button
        variant="tertiary"
        size="default"
        onClick={onClick}
        disabled={disabled}
        className="text-text-3 hover:text-text-1"
        data-testid={dataTestId}
      >
        {label}
      </Button>
    </div>
  );
}
