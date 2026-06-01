import ModelIcon from "@src/components/ModelIcon";

interface ModelTableTooltipContentProps {
  model: string;
}

export default function ModelTableTooltipContent({
  model,
}: ModelTableTooltipContentProps) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <ModelIcon modelName={model} size="small" monochrome />
      <span className="truncate text-white">{model}</span>
    </span>
  );
}
