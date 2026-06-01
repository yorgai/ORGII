# Add password reset flow

## Requirements

- Add a "Forgot password?" link on the existing login page
- Backend: POST /api/auth/reset-request that accepts an email address and generates a time-limited reset token
- Backend: POST /api/auth/reset-confirm that validates the token and sets the new password
- Frontend: password reset request form (enter email, submit, show success message)
- Frontend: password reset confirm form (enter new password, confirm password, submit)
- New password must meet strength requirements (min 8 chars, at least one uppercase, one number)
- Reuse JWT and auth patterns from the login implementation

## Acceptance Criteria

1. User can request a password reset by entering their email
2. Reset token is time-limited (expires after 1 hour)
3. User can set a new password using a valid token
4. Password strength validation shows clear feedback
5. Expired or invalid tokens show an appropriate error
6. Auth patterns from the login feature are reused consistently
