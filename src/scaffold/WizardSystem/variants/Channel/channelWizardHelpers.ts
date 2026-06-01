import { parseCommaSeparated } from "@src/modules/MainApp/Integrations/Connections/Channels/utils";

export interface ChannelWizardErrors {
  type?: string;
  name?: string;
}

export function buildConfigData(
  channelConfig: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { enabled: true };

  for (const [key, value] of Object.entries(channelConfig)) {
    if (key === "allowFrom" && typeof value === "string") {
      result[key] = parseCommaSeparated(value);
    } else if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

export function normalizeAccountName(accountName: string): string {
  return accountName.trim().toLowerCase().replace(/\s+/g, "-");
}

export function hasDuplicateAccountName(
  selectedType: string | null,
  normalizedAccountName: string,
  existingAccounts: Map<string, string[]>
): boolean {
  return (
    !!selectedType &&
    normalizedAccountName !== "" &&
    (existingAccounts.get(selectedType) ?? []).includes(normalizedAccountName)
  );
}

export interface AccountNameValidationMessages {
  required: string;
  duplicate: string;
}

export function validateAccountName(
  accountName: string,
  isDuplicateName: boolean,
  messages: AccountNameValidationMessages
): ChannelWizardErrors {
  if (!accountName.trim()) return { name: messages.required };
  if (isDuplicateName) return { name: messages.duplicate };
  return {};
}

export function extractHostedUserId(hostedToken: string): string {
  const payload = JSON.parse(atob(hostedToken.split(".")[1])) as {
    sub: string;
  };
  return payload.sub;
}
