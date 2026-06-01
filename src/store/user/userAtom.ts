import { atomWithStorage, createJSONStorage } from "jotai/utils";

import { IUserInfo } from "@src/types/core/user";

const DEFAULT_USER: IUserInfo = {
  uuid: "",
  name: "",
  authing_id: "",
  profile: "",
  picture: "",
  openai_api_key: "",
  profile_image_url: "",
  deepseek_api_key: "",
  git_user_name: "",
  git_user_email: "",
  github_infos: [],
  gitlab_infos: [],

  // Market fields
  provider_id: undefined,
  consumer_id: undefined,
  role: "consumer", // Default role
  stripe_account_status: undefined,
  stripe_onboarding_complete: false,
  wallet_balance: 0,
};

// Use synchronous storage to avoid hydration timing issues during HMR
const syncStorage = createJSONStorage<IUserInfo>(() => localStorage);

/**
 * User info atom - persisted to localStorage
 * Survives hot reloads and page refreshes
 */
export const userAtom = atomWithStorage<IUserInfo>(
  "orgii-user-info",
  DEFAULT_USER,
  syncStorage,
  { getOnInit: true } // Read from storage immediately on init
);
userAtom.debugLabel = "userAtom";
