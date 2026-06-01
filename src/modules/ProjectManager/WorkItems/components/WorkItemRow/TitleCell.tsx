interface TitleCellProps {
  name: string | undefined;
  untitledLabel: string;
}

export function TitleCell({ name, untitledLabel }: TitleCellProps) {
  return (
    <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-1">
      {name || <span className="text-text-4">{untitledLabel}</span>}
    </div>
  );
}
