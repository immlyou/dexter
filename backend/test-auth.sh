#!/bin/bash

# Dexter Backend - Authentication Testing Script
# This script tests all authentication endpoints

set -e

BASE_URL="http://localhost:8000"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 Dexter Backend - Authentication Testing"
echo "=========================================="
echo ""

# Test 1: Health Check
echo "Test 1: Health Check"
response=$(curl -s ${BASE_URL}/health)
if echo "$response" | grep -q "healthy"; then
    echo -e "${GREEN}✅ Health check passed${NC}"
else
    echo -e "${RED}❌ Health check failed${NC}"
    echo "$response"
    exit 1
fi
echo ""

# Test 2: Register User
echo "Test 2: Register User"
register_response=$(curl -s -X POST ${BASE_URL}/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "name": "Test User"
  }')

if echo "$register_response" | grep -q "token"; then
    echo -e "${GREEN}✅ User registration passed${NC}"
    ACCESS_TOKEN=$(echo "$register_response" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
    REFRESH_TOKEN=$(echo "$register_response" | grep -o '"refreshToken":"[^"]*' | cut -d'"' -f4)
    echo "   Access Token: ${ACCESS_TOKEN:0:50}..."
else
    echo -e "${RED}❌ User registration failed${NC}"
    echo "$register_response"
    exit 1
fi
echo ""

# Test 3: Login User
echo "Test 3: Login User"
login_response=$(curl -s -X POST ${BASE_URL}/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }')

if echo "$login_response" | grep -q "token"; then
    echo -e "${GREEN}✅ User login passed${NC}"
    ACCESS_TOKEN=$(echo "$login_response" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
else
    echo -e "${RED}❌ User login failed${NC}"
    echo "$login_response"
    exit 1
fi
echo ""

# Test 4: Get Current User (Protected Route)
echo "Test 4: Get Current User (Protected Route)"
me_response=$(curl -s ${BASE_URL}/api/auth/me \
  -H "Authorization: Bearer ${ACCESS_TOKEN}")

if echo "$me_response" | grep -q "test@example.com"; then
    echo -e "${GREEN}✅ Protected route access passed${NC}"
else
    echo -e "${RED}❌ Protected route access failed${NC}"
    echo "$me_response"
    exit 1
fi
echo ""

# Test 5: Invalid Credentials
echo "Test 5: Invalid Credentials (Should Fail)"
invalid_response=$(curl -s -X POST ${BASE_URL}/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "wrongpassword"
  }')

if echo "$invalid_response" | grep -q "INVALID_CREDENTIALS"; then
    echo -e "${GREEN}✅ Invalid credentials correctly rejected${NC}"
else
    echo -e "${RED}❌ Invalid credentials test failed${NC}"
    echo "$invalid_response"
    exit 1
fi
echo ""

# Test 6: Duplicate Registration
echo "Test 6: Duplicate Registration (Should Fail)"
duplicate_response=$(curl -s -X POST ${BASE_URL}/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "name": "Test User 2"
  }')

if echo "$duplicate_response" | grep -q "USER_ALREADY_EXISTS"; then
    echo -e "${GREEN}✅ Duplicate registration correctly rejected${NC}"
else
    echo -e "${RED}❌ Duplicate registration test failed${NC}"
    echo "$duplicate_response"
    exit 1
fi
echo ""

# Test 7: Protected Route Without Token
echo "Test 7: Protected Route Without Token (Should Fail)"
no_token_response=$(curl -s ${BASE_URL}/api/auth/me)

if echo "$no_token_response" | grep -q "AUTH_REQUIRED"; then
    echo -e "${GREEN}✅ Protected route correctly requires authentication${NC}"
else
    echo -e "${RED}❌ Protected route without token test failed${NC}"
    echo "$no_token_response"
    exit 1
fi
echo ""

# Test 8: Refresh Token
echo "Test 8: Refresh Token"
refresh_response=$(curl -s -X POST ${BASE_URL}/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{
    \"refreshToken\": \"${REFRESH_TOKEN}\"
  }")

if echo "$refresh_response" | grep -q "token"; then
    echo -e "${GREEN}✅ Token refresh passed${NC}"
    NEW_ACCESS_TOKEN=$(echo "$refresh_response" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
    NEW_REFRESH_TOKEN=$(echo "$refresh_response" | grep -o '"refreshToken":"[^"]*' | cut -d'"' -f4)
else
    echo -e "${RED}❌ Token refresh failed${NC}"
    echo "$refresh_response"
    exit 1
fi
echo ""

# Test 9: Logout
echo "Test 9: Logout"
logout_response=$(curl -s -X POST ${BASE_URL}/api/auth/logout \
  -H "Content-Type: application/json" \
  -d "{
    \"refreshToken\": \"${NEW_REFRESH_TOKEN}\"
  }")

if echo "$logout_response" | grep -q "success"; then
    echo -e "${GREEN}✅ Logout passed${NC}"
else
    echo -e "${RED}❌ Logout failed${NC}"
    echo "$logout_response"
    exit 1
fi
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}🎉 All authentication tests passed!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Report results to team lead"
echo "2. Begin Week 2: Session Management API"
echo "3. Begin Week 2: Query Execution API"
echo ""
