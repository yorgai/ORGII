# Add user login page with JWT authentication

## Requirements

- Login form with email and password fields
- Backend JWT auth endpoint (POST /api/auth/login) that validates credentials and returns a JWT
- Store JWT in an httpOnly cookie (not localStorage) for security
- Protected route wrapper component that redirects unauthenticated users to login
- Logout endpoint (POST /api/auth/logout) that clears the cookie
- Display login errors (invalid credentials, network errors)

## Acceptance Criteria

1. User can log in with valid credentials and is redirected to the dashboard
2. Invalid credentials show a clear error message
3. JWT is stored securely in an httpOnly cookie, never in localStorage
4. Protected routes redirect unauthenticated users to the login page
5. Logout clears the session and redirects to login
