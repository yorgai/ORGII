/**
 * PropsPanel - Component props editor
 * Displays editable controls for each prop
 */
import { type FC, memo } from "react";
import { useTranslation } from "react-i18next";

import { Placeholder } from "@src/modules/shared/layouts/blocks";

import { PropEditor } from "../PropEditor";
import type { PropsPanelProps } from "../types";

export const PropsPanel: FC<PropsPanelProps> = memo(
  ({ props, values, onChange }) => {
    const { t } = useTranslation();

    if (props.length === 0) {
      return (
        <Placeholder variant="empty" title={t("placeholders.noPropsFound")} />
      );
    }

    return (
      <div className="flex flex-col gap-2 p-3">
        {props.map((prop) => (
          <div key={prop.name} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-1">
                {prop.name}
              </span>
              {prop.required && <span className="text-xs text-red-500">*</span>}
              <span className="text-xs text-text-4">
                {prop.type_annotation}
              </span>
            </div>
            {prop.description && (
              <p className="text-xs text-text-3">{prop.description}</p>
            )}
            <PropEditor
              prop={prop}
              value={values[prop.name]}
              onChange={(value) => onChange(prop.name, value)}
            />
          </div>
        ))}
      </div>
    );
  }
);

PropsPanel.displayName = "PropsPanel";
