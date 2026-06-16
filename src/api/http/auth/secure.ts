import {
  type SupabaseTokenResponse,
  getSupabaseHostedToken,
  signOutSupabase,
  syncHostedTokenFromSession,
} from "./supabase";
import { getSupabaseAuthClient } from "./supabase";

export interface AuthState {
  is_authenticated: boolean;
  access_token: string | null;
  expires_in: number | null;
  user_id: string | null;
}

export type TokenResponse = SupabaseTokenResponse;

export async function secureGetAuthState(): Promise<AuthState> {
  const supabase = getSupabaseAuthClient();
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  if (!data.session) {
    return {
      is_authenticated: false,
      access_token: null,
      expires_in: null,
      user_id: null,
    };
  }

  syncHostedTokenFromSession(data.session);

  return {
    is_authenticated: true,
    access_token: data.session.access_token,
    expires_in: data.session.expires_in,
    user_id: data.session.user.id,
  };
}

export async function secureGetAccessToken(): Promise<string | null> {
  return getSupabaseHostedToken();
}

export async function secureGetRefreshToken(): Promise<string | null> {
  const supabase = getSupabaseAuthClient();
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  return data.session?.refresh_token ?? null;
}

export async function secureIsTokenExpiring(
  thresholdSeconds: number = 300
): Promise<boolean> {
  const supabase = getSupabaseAuthClient();
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }
  if (!data.session?.expires_at) {
    return true;
  }

  return Date.now() + thresholdSeconds * 1000 >= data.session.expires_at * 1000;
}

export async function secureClearTokens(): Promise<void> {
  await signOutSupabase();
}
