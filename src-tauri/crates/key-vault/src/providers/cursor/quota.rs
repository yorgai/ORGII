//! Cursor quota fetching and usage response parsing

use serde::Deserialize;

use crate::types::{QuotaInfo, UsageItem};

use super::CursorValidator;

pub(crate) const CURSOR_USAGE_API_URL: &str = "https://api2.cursor.sh";

/// Cursor usage summary API response
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageSummaryResponse {
    membership_type: Option<String>,
    #[serde(default)]
    is_unlimited: bool,
    individual_usage: Option<IndividualUsage>,
    team_usage: Option<TeamUsage>,
    auto_model_selected_display_message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct IndividualUsage {
    plan: Option<UsageDetail>,
    on_demand: Option<UsageDetail>,
    overall: Option<UsageDetail>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TeamUsage {
    pooled: Option<UsageDetail>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(super) struct UsageDetail {
    #[serde(default)]
    enabled: bool,
    used: Option<i64>,
    limit: Option<i64>,
    remaining: Option<i64>,
    breakdown: Option<UsageBreakdown>,
    total_percent_used: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub(super) struct UsageBreakdown {
    included: Option<i64>,
    bonus: Option<i64>,
    total: Option<i64>,
}

impl CursorValidator {
    /// Fetch quota from Cursor API
    ///
    /// Tries both token formats:
    /// 1. Bearer token with just JWT
    /// 2. Cookie with full token (user_id%3A%3AJWT or just JWT)
    ///
    /// # Arguments
    /// * `session_token` - Cursor session token (format: user_id%3A%3AJWT or just JWT)
    pub async fn fetch_quota(&self, session_token: &str) -> Result<QuotaInfo, String> {
        if session_token.is_empty() {
            return Err("No session token provided".to_string());
        }

        // Decode URL-encoded token and extract JWT
        let decoded_token = urlencoding::decode(session_token)
            .map(|s| s.into_owned())
            .unwrap_or_else(|_| session_token.to_string());

        let jwt_token = if decoded_token.contains("::") {
            decoded_token.split("::").last().unwrap_or(&decoded_token)
        } else {
            &decoded_token
        };

        let url = format!("{}/auth/usage-summary", self.usage_api_url);

        // Try 1: Bearer token with just JWT
        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", jwt_token))
            .header("Content-Type", "application/json")
            .timeout(self.http_timeout)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let status = response.status();

        // If auth failed, try alternative format with Cookie
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            // Try 2: Cookie with full token (original format)
            let response_alt = self
                .client
                .get(&url)
                .header(
                    "Cookie",
                    format!("WorkosCursorSessionToken={}", session_token),
                )
                .header("Content-Type", "application/json")
                .timeout(self.http_timeout)
                .send()
                .await
                .map_err(|e| format!("Request failed (retry): {}", e))?;

            let status_alt = response_alt.status();
            if status_alt == reqwest::StatusCode::UNAUTHORIZED {
                return Err("Session token expired or invalid".to_string());
            }
            if !status_alt.is_success() {
                return Err(format!("HTTP {}", status_alt.as_u16()));
            }

            let data: UsageSummaryResponse = response_alt
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;

            return Ok(self.parse_usage_response(data));
        }

        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }

        let data: UsageSummaryResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        Ok(self.parse_usage_response(data))
    }

    /// Parse Cursor usage-summary API response into QuotaInfo
    pub(crate) fn parse_usage_response(&self, data: UsageSummaryResponse) -> QuotaInfo {
        let mut usage_items: Vec<UsageItem> = Vec::new();

        let plan_type = data
            .membership_type
            .clone()
            .unwrap_or_else(|| "unknown".to_string());
        let is_unlimited = data.is_unlimited;

        // Parse individualUsage
        let individual = data.individual_usage.unwrap_or(IndividualUsage {
            plan: None,
            on_demand: None,
            overall: None,
        });

        let mut plan_remaining: i64 = 0;
        let mut plan_total: i64 = 0;
        let mut on_demand_remaining: i64 = 0;
        let mut on_demand_limit: Option<i64> = None;
        let mut on_demand_is_unlimited = false;

        // Plan usage
        if let Some(ref plan_data) = individual.plan {
            if plan_data.enabled {
                // Get total from breakdown (includes bonus), fallback to limit
                plan_total = plan_data
                    .breakdown
                    .as_ref()
                    .and_then(|b| b.total)
                    .or(plan_data.limit)
                    .unwrap_or(0);

                plan_remaining = plan_data.remaining.unwrap_or(0).min(plan_total);

                let plan_remaining_pct = if plan_total > 0 {
                    ((plan_remaining as f64 / plan_total as f64) * 100.0).clamp(0.0, 100.0)
                } else {
                    100.0
                };

                usage_items.push(UsageItem {
                    usage_type: "plan".to_string(),
                    enabled: true,
                    used: plan_data.used,
                    limit: Some(plan_total),
                    remaining: Some(plan_remaining),
                    remaining_percentage: plan_remaining_pct,
                });
            }
        }

        // On-demand usage
        if let Some(ref on_demand_data) = individual.on_demand {
            if on_demand_data.enabled {
                let used = on_demand_data.used.unwrap_or(0);
                on_demand_limit = on_demand_data.limit;
                on_demand_is_unlimited = on_demand_limit.is_none();

                let (remaining, remaining_pct) = if let Some(limit) = on_demand_limit {
                    if limit > 0 {
                        let rem = (limit - used).max(0);
                        on_demand_remaining = rem;
                        (
                            Some(rem),
                            ((rem as f64 / limit as f64) * 100.0).clamp(0.0, 100.0),
                        )
                    } else {
                        (Some(0), 100.0)
                    }
                } else {
                    // Unlimited
                    (None, 100.0)
                };

                usage_items.push(UsageItem {
                    usage_type: "on_demand".to_string(),
                    enabled: true,
                    used: Some(used),
                    limit: on_demand_limit,
                    remaining,
                    remaining_percentage: remaining_pct,
                });
            }
        }

        // Overall usage (enterprise individual quota)
        if let Some(ref overall_data) = individual.overall {
            if overall_data.enabled {
                let used = overall_data.used.unwrap_or(0);
                let limit = overall_data.limit.unwrap_or(0);
                let remaining = overall_data.remaining.unwrap_or(0).min(limit);
                let remaining_pct = if limit > 0 {
                    ((remaining as f64 / limit as f64) * 100.0).clamp(0.0, 100.0)
                } else {
                    100.0
                };

                usage_items.push(UsageItem {
                    usage_type: "individual_overall".to_string(),
                    enabled: true,
                    used: Some(used),
                    limit: Some(limit),
                    remaining: Some(remaining),
                    remaining_percentage: remaining_pct,
                });
            }
        }

        // Team pooled usage
        if let Some(team) = data.team_usage {
            if let Some(pooled) = team.pooled {
                if pooled.enabled {
                    let used = pooled.used.unwrap_or(0);
                    let limit = pooled.limit.unwrap_or(0);
                    let remaining = pooled.remaining.unwrap_or(0).min(limit);
                    let remaining_pct = if limit > 0 {
                        ((remaining as f64 / limit as f64) * 100.0).clamp(0.0, 100.0)
                    } else {
                        100.0
                    };

                    usage_items.push(UsageItem {
                        usage_type: "team_pooled".to_string(),
                        enabled: true,
                        used: Some(used),
                        limit: Some(limit),
                        remaining: Some(remaining),
                        remaining_percentage: remaining_pct,
                    });
                }
            }
        }

        // If unlimited and no usage items, create synthetic item
        if is_unlimited && usage_items.is_empty() {
            usage_items.push(UsageItem {
                usage_type: "plan".to_string(),
                enabled: true,
                used: Some(0),
                limit: Some(0),
                remaining: Some(0),
                remaining_percentage: 100.0,
            });
        }

        // Calculate overall remaining percentage
        let remaining_pct = if on_demand_is_unlimited {
            100.0
        } else if on_demand_limit.is_some() {
            let total_remaining = on_demand_remaining + plan_remaining;
            let total_capacity = plan_total + on_demand_limit.unwrap_or(0);
            if total_capacity > 0 {
                ((total_remaining as f64 / total_capacity as f64) * 100.0).clamp(0.0, 100.0)
            } else {
                0.0
            }
        } else if !usage_items.is_empty() {
            usage_items[0].remaining_percentage
        } else {
            0.0
        };

        QuotaInfo {
            remaining_percentage: remaining_pct,
            plan_type: Some(plan_type),
            is_unlimited,
            usage_items,
            auto_message: data.auto_model_selected_display_message,
            ..Default::default()
        }
    }
}
