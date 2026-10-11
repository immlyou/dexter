# Deployment Guide

Complete guide for deploying Dexter Backend API to production.

## Pre-Deployment Checklist

- [ ] Database setup completed
- [ ] All environment variables configured
- [ ] API keys obtained and set
- [ ] SSL certificates configured (if applicable)
- [ ] Domain name configured (if applicable)
- [ ] CORS origin set correctly
- [ ] JWT_SECRET is strong and unique
- [ ] Database migrations tested
- [ ] Application tested locally with production build

## Environment Setup

### 1. Database Setup

#### Option A: Neon (Recommended for Serverless)

1. Create account at [neon.tech](https://neon.tech)
2. Create new project
3. Copy connection string
4. Set `DATABASE_URL` in environment

```bash
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

#### Option B: AWS RDS

1. Create PostgreSQL 16 instance
2. Configure security groups
3. Enable public access (if needed)
4. Copy connection string

```bash
DATABASE_URL=postgresql://user:pass@instance.region.rds.amazonaws.com:5432/dexter
```

#### Option C: Self-Hosted PostgreSQL

```bash
# Install PostgreSQL 16
sudo apt install postgresql-16

# Create database and user
sudo -u postgres psql
CREATE DATABASE dexter;
CREATE USER dexter WITH PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE dexter TO dexter;
```

### 2. Environment Variables

Create `.env.production`:

```bash
# Server
PORT=8000
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dexter

# JWT - MUST be strong random string
JWT_SECRET=generate-with-openssl-rand-base64-32
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=30d

# CORS - Set to your frontend domain
CORS_ORIGIN=https://your-frontend-domain.com

# LLM API Keys
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx
GOOGLE_API_KEY=xxx
FINANCIAL_DATASETS_API_KEY=xxx
EXASEARCH_API_KEY=xxx
```

Generate secure JWT secret:
```bash
openssl rand -base64 32
```

## Deployment Options

### Option 1: Docker Deployment (Recommended)

#### On Any Server with Docker

```bash
# 1. Clone repository
git clone https://github.com/your-org/dexter.git
cd dexter/backend

# 2. Create .env file
nano .env
# Paste production environment variables

# 3. Build and start services
docker-compose up -d

# 4. Run migrations
docker-compose exec api bun db:migrate

# 5. Check logs
docker-compose logs -f api

# 6. Test API
curl http://localhost:8000/health
```

#### With Nginx Reverse Proxy

Create `/etc/nginx/sites-available/dexter-api`:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
    location /stream {
        proxy_pass http://localhost:8000/stream;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

Enable and configure SSL:
```bash
sudo ln -s /etc/nginx/sites-available/dexter-api /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.yourdomain.com
sudo systemctl restart nginx
```

### Option 2: Fly.io Deployment

Create `fly.toml`:

```toml
app = "dexter-api"
primary_region = "sjc"

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8000"
  NODE_ENV = "production"

[[services]]
  internal_port = 8000
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80
    force_https = true

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [[services.http_checks]]
    interval = 10000
    method = "GET"
    path = "/health"
    timeout = 2000
```

Deploy:
```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Login
flyctl auth login

# Create app
flyctl launch

# Set secrets
flyctl secrets set DATABASE_URL="postgresql://..."
flyctl secrets set JWT_SECRET="..."
flyctl secrets set ANTHROPIC_API_KEY="..."
# ... set all other secrets

# Deploy
flyctl deploy

# Run migrations
flyctl ssh console
bun db:migrate
```

### Option 3: Railway Deployment

1. Go to [railway.app](https://railway.app)
2. Create new project
3. Add PostgreSQL database
4. Deploy from GitHub
5. Set environment variables in Railway dashboard
6. Enable public networking
7. Run migrations via Railway CLI:

```bash
railway run bun db:migrate
```

### Option 4: AWS ECS with Fargate

1. **Push Docker image to ECR**:

```bash
# Create ECR repository
aws ecr create-repository --repository-name dexter-api

# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build and push
docker build -t dexter-api .
docker tag dexter-api:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/dexter-api:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/dexter-api:latest
```

2. **Create ECS Task Definition** with environment variables
3. **Create ECS Service** with load balancer
4. **Configure ALB** for HTTP/HTTPS and WebSocket support
5. **Run migrations** via ECS task

### Option 5: VPS Deployment (Ubuntu)

```bash
# 1. Install dependencies
curl -fsSL https://bun.sh/install | bash
sudo apt install postgresql-16 nginx

# 2. Clone repository
git clone https://github.com/your-org/dexter.git
cd dexter/backend

# 3. Install dependencies
bun install

# 4. Set up environment
cp .env.example .env
nano .env  # Edit with production values

# 5. Run migrations
bun db:migrate

# 6. Create systemd service
sudo nano /etc/systemd/system/dexter-api.service
```

Add to service file:
```ini
[Unit]
Description=Dexter API Server
After=network.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/dexter/backend
Environment="NODE_ENV=production"
EnvironmentFile=/home/ubuntu/dexter/backend/.env
ExecStart=/home/ubuntu/.bun/bin/bun src/server.ts
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Start service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable dexter-api
sudo systemctl start dexter-api
sudo systemctl status dexter-api
```

## Post-Deployment

### 1. Verify Deployment

```bash
# Health check
curl https://api.yourdomain.com/health

# Register test user
curl -X POST https://api.yourdomain.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123","name":"Test"}'

# Test WebSocket (use test-websocket.html)
# Update URL to wss://api.yourdomain.com/stream
```

### 2. Monitoring Setup

#### Application Logs

For Docker:
```bash
docker-compose logs -f api
```

For systemd:
```bash
journalctl -u dexter-api -f
```

#### Database Monitoring

```bash
# Connect to database
psql $DATABASE_URL

# Check table sizes
SELECT schemaname, tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

# Check connection count
SELECT count(*) FROM pg_stat_activity;
```

#### Performance Monitoring

Use tools like:
- **Prometheus** + **Grafana** for metrics
- **Sentry** for error tracking
- **DataDog** for APM
- **New Relic** for full observability

### 3. Backup Strategy

#### Database Backups

Automated daily backup:
```bash
#!/bin/bash
# /etc/cron.daily/backup-dexter-db

BACKUP_DIR="/var/backups/dexter"
DATE=$(date +%Y%m%d_%H%M%S)
DATABASE_URL="your-database-url"

mkdir -p $BACKUP_DIR
pg_dump $DATABASE_URL | gzip > $BACKUP_DIR/dexter_$DATE.sql.gz

# Keep only last 7 days
find $BACKUP_DIR -name "dexter_*.sql.gz" -mtime +7 -delete
```

#### Restore from Backup

```bash
gunzip -c backup.sql.gz | psql $DATABASE_URL
```

### 4. SSL/TLS Setup

Using Let's Encrypt:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
sudo certbot renew --dry-run  # Test renewal
```

### 5. Security Hardening

```bash
# Enable firewall
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable

# Limit SSH access
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
# Set: PasswordAuthentication no

# Keep system updated
sudo apt update && sudo apt upgrade -y
sudo apt install unattended-upgrades
```

### 6. Rate Limiting

Add to Nginx config:
```nginx
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

server {
    location /api {
        limit_req zone=api_limit burst=20 nodelay;
        # ... rest of config
    }
}
```

## Scaling

### Horizontal Scaling

Run multiple instances behind a load balancer:

```yaml
# docker-compose.scale.yml
version: '3.8'

services:
  api:
    # ... same config
    deploy:
      replicas: 3

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - api
```

### Database Connection Pooling

Already handled by Drizzle + Bun.sql, but monitor:
```sql
-- Check connection pool usage
SELECT * FROM pg_stat_database WHERE datname = 'dexter';
```

### Caching Strategy

Add Redis for session caching (future optimization):
```yaml
# Add to docker-compose.yml
redis:
  image: redis:7-alpine
  ports:
    - "6379:6379"
```

## Maintenance

### Database Migrations

```bash
# Generate new migration
bun db:generate

# Review migration in drizzle/ folder

# Apply migration
bun db:migrate

# Or in production container
docker-compose exec api bun db:migrate
```

### Rollback Strategy

1. Keep previous Docker image tagged
2. Database migration rollbacks (manual)
3. Keep backups before major updates

### Updates

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# Run new migrations
docker-compose exec api bun db:migrate

# Check logs
docker-compose logs -f api
```

## Troubleshooting

### API not responding

```bash
# Check if service is running
docker-compose ps
# or
sudo systemctl status dexter-api

# Check logs
docker-compose logs api --tail=100
# or
journalctl -u dexter-api -n 100

# Check port binding
sudo netstat -tlnp | grep 8000
```

### Database connection errors

```bash
# Test database connection
psql $DATABASE_URL

# Check PostgreSQL is running
sudo systemctl status postgresql
# or (Docker)
docker-compose ps postgres

# Check connection limit
psql $DATABASE_URL -c "SELECT * FROM pg_stat_activity;"
```

### High memory usage

```bash
# Check container stats
docker stats

# Restart service
docker-compose restart api

# Check Node.js heap
# Add to .env: NODE_OPTIONS="--max-old-space-size=2048"
```

### WebSocket not connecting

- Verify Nginx WebSocket proxy configuration
- Check CORS settings
- Verify SSL/TLS on wss:// connections
- Check firewall allows WebSocket ports

## Support

For deployment issues:
- Check logs first
- Review this guide
- GitHub Issues: https://github.com/your-org/dexter/issues
- Documentation: README.md, API-USAGE.md
