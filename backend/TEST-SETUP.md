# Dexter Backend - Database Setup & Testing Guide

## Step 1: Get Neon Database URL

1. Visit https://neon.tech
2. Click "Sign Up" (or "Sign In" if you have an account)
3. Create a new project:
   - Name: `dexter-dev`
   - Region: Choose closest to you
   - PostgreSQL version: 16
4. Copy the connection string from the dashboard
   - It will look like: `postgresql://username:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require`

## Step 2: Update Environment Variables

Replace the `DATABASE_URL` in `/Users/chris-m4/dexter/backend/.env`:

```bash
# Change this line:
DATABASE_URL=postgresql://dexter:dexter123@localhost:5432/dexter

# To your Neon URL:
DATABASE_URL=postgresql://username:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require
```

## Step 3: Run Migrations

```bash
cd /Users/chris-m4/dexter/backend
bun db:migrate
```

**Expected output:**
```
⏳ Running database migrations...
✅ Migrations completed successfully
```

## Step 4: Verify Database Tables

After migration, you should have 8 tables:
- users
- sessions
- queries
- query_events
- tool_results
- api_keys
- refresh_tokens
- usage_tracking

## Step 5: Start the Server

```bash
bun dev
```

**Expected output:**
```
🚀 Dexter API server starting on port 8000
Started development server: http://localhost:8000
```

## Step 6: Test Authentication Endpoints

### Test 1: Health Check
```bash
curl http://localhost:8000/health
```

**Expected response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-11T...",
  "version": "1.0.0"
}
```

### Test 2: Register User
```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "name": "Test User"
  }'
```

**Expected response:**
```json
{
  "userId": "...",
  "token": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "...",
    "email": "test@example.com",
    "name": "Test User",
    "plan": "free",
    "createdAt": "..."
  }
}
```

**Save the token for next steps!**

### Test 3: Login User
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

**Expected response:**
```json
{
  "userId": "...",
  "token": "eyJhbGc...",
  "refreshToken": "eyJhbGc...",
  "user": {
    "id": "...",
    "email": "test@example.com",
    "name": "Test User",
    "plan": "free"
  }
}
```

### Test 4: Get Current User (Protected Route)
```bash
# Replace <YOUR_TOKEN> with the token from register/login response
curl http://localhost:8000/api/auth/me \
  -H "Authorization: Bearer <YOUR_TOKEN>"
```

**Expected response:**
```json
{
  "userId": "...",
  "email": "test@example.com",
  "name": "Test User",
  "plan": "free",
  "preferences": {},
  "emailVerified": false,
  "createdAt": "...",
  "updatedAt": "..."
}
```

### Test 5: Refresh Token
```bash
# Replace <YOUR_REFRESH_TOKEN> with the refresh token from login
curl -X POST http://localhost:8000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<YOUR_REFRESH_TOKEN>"
  }'
```

**Expected response:**
```json
{
  "token": "eyJhbGc...",
  "refreshToken": "eyJhbGc..."
}
```

### Test 6: Logout
```bash
curl -X POST http://localhost:8000/api/auth/logout \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "<YOUR_REFRESH_TOKEN>"
  }'
```

**Expected response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

## Error Test Cases

### Test 7: Invalid Credentials
```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "wrongpassword"
  }'
```

**Expected response (401):**
```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid email or password",
    "timestamp": "..."
  }
}
```

### Test 8: Duplicate Registration
```bash
curl -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "name": "Test User 2"
  }'
```

**Expected response (409):**
```json
{
  "error": {
    "code": "USER_ALREADY_EXISTS",
    "message": "A user with this email already exists",
    "timestamp": "..."
  }
}
```

### Test 9: Protected Route Without Token
```bash
curl http://localhost:8000/api/auth/me
```

**Expected response (401):**
```json
{
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "Authentication required",
    "timestamp": "..."
  }
}
```

### Test 10: Invalid Token
```bash
curl http://localhost:8000/api/auth/me \
  -H "Authorization: Bearer invalid_token_here"
```

**Expected response (401):**
```json
{
  "error": {
    "code": "AUTH_INVALID_TOKEN",
    "message": "Invalid authentication token",
    "timestamp": "..."
  }
}
```

## Troubleshooting

### Migration Fails
- Check DATABASE_URL is correct
- Verify network connection to Neon
- Check Neon dashboard for connection status

### Server Won't Start
- Check port 8000 is not in use: `lsof -i :8000`
- Check .env file exists and is valid
- Run `bun install` to ensure dependencies are installed

### Authentication Fails
- Verify database has the users table
- Check JWT_SECRET is set in .env
- Check server logs for detailed errors

## Success Criteria

✅ All 8 tables created in database
✅ Server starts without errors
✅ Can register a new user
✅ Can login with correct credentials
✅ Login fails with wrong credentials
✅ Protected route works with valid token
✅ Protected route fails without token
✅ Can refresh access token
✅ Can logout (revoke refresh token)

## Next Steps After Testing

Once all tests pass:
1. Report results to team lead
2. Begin Week 2: Session Management API
3. Begin Week 2: Query Execution API
4. Begin Week 2: Agent Service Integration

---

**Note:** Keep your access token handy for testing protected routes!
