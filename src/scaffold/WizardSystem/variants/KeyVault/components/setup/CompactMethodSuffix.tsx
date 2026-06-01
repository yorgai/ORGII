/**
 * CompactMethodRow
 *
 * Single-line compact display for when the full SelectionGrid is collapsed
 * (e.g. browser is open). Renders:
 *   Setup Method: Guided Setup          [Switch method]
 */
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import type { SelectionGridOption } from "@src/scaffold/WizardSystem/primitives";

interface CompactMethodRowProps<T extends string = string> {
  /** Field title (e.g. "Setup Method") */
  title: string;
  options: SelectionGridOption<T>[];
  selected: T | null;
  onSelect: (key: T) => void;
  /** Override display label (defaults to selected option label) */
  label?: string;
  className?: string;
}

function CompactMethodRow<T extends string = string>({
  title,
  options,
  selected,
  onSelect,
  label,
  className,
}: CompactMethodRowProps<T>) {
  const { t } = useTranslation("integrations");
  const selectedOption = options.find((opt) => opt.key === selected);
  const displayLabel = label || selectedOption?.label || "";
  const nextOption = options.find((opt) => opt.key !== selected);

  return (
    <div className={`flex items-center justify-between ${className ?? ""}`}>
      <span className="text-[12px] font-medium text-text-2">
        {title}:{" "}
        <span className="font-bold text-primary-6">{displayLabel}</span>
      </span>
      {nextOption && (
        <Button
          variant="tertiary"
          size="mini"
          onClick={() => onSelect(nextOption.key)}
        >
          {t("keyVault.switchMethod")}
        </Button>
      )}
    </div>
  );
}

export { CompactMethodRow };
