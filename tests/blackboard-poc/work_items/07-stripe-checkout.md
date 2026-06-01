# Add Stripe subscription checkout

## Requirements

- Backend: POST /api/checkout/create-session that creates a Stripe Checkout Session for a monthly subscription plan
- Backend: POST /api/webhook/stripe that handles checkout.session.completed and customer.subscription.updated events with signature verification
- Backend: GET /api/subscription/status that returns current user's subscription status (active, cancelled, past_due)
- Frontend: Pricing page component showing plan options (Free, Pro $19/mo, Team $49/mo)
- Frontend: Checkout button that calls the backend and redirects to Stripe Checkout
- Frontend: Subscription status banner that shows current plan and expiry
- Shared types file for plan IDs, subscription statuses, and API response shapes
- Webhook endpoint must verify Stripe signature to prevent spoofing

## Acceptance Criteria

1. User can click a plan and be redirected to Stripe Checkout
2. After successful payment, webhook updates subscription status in database
3. Subscription status page shows current plan, renewal date, and cancel option
4. Webhook endpoint verifies Stripe-Signature header (rejects invalid signatures)
5. Free tier users see upgrade prompts, paid users see their plan details
6. API response types are shared between frontend and backend (no type drift)
