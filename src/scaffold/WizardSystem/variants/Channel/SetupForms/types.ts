/**
 * Shared types for channel wizard setup forms.
 */
import type { FC } from "react";

export interface ChannelFormProps {
  config: Record<string, unknown>;
  onChange: (updates: Record<string, unknown>) => void;
}

export type ChannelFormComponent = FC<ChannelFormProps>;

export const getString = (
  config: Record<string, unknown>,
  key: string
): string => {
  const val = config[key];
  return typeof val === "string" ? val : "";
};

export const getBool = (
  config: Record<string, unknown>,
  key: string,
  defaultVal = false
): boolean => {
  const val = config[key];
  return typeof val === "boolean" ? val : defaultVal;
};

export const getNumber = (
  config: Record<string, unknown>,
  key: string,
  defaultVal: number
): number => {
  const val = config[key];
  return typeof val === "number" ? val : defaultVal;
};
