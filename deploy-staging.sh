#!/bin/bash

# ============================================================================
# CMV Backend - Staging Deployment Script
# ============================================================================
# Usage: ./deploy-staging.sh
# 
# This script deploys the CMV Backend to STAGING environment.
# Staging is for testing before production deployment.
#
# Prerequisites:
# - Node.js 18+ installed
# - PM2 installed globally (npm install -g pm2)
# - .env file configured for staging
# ============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="cmv-staging-server"
CRON_NAME="cmv-staging-cron"
PORT=5002
LOG_DIR="./logs"

echo -e "${CYAN}============================================================================${NC}"
echo -e "${CYAN}     CMV Backend - Staging Deployment${NC}"
echo -e "${CYAN}============================================================================${NC}"
echo ""

# ============================================================================
# Pre-flight Checks
# ============================================================================
echo -e "${YELLOW}🔍 Running pre-flight checks...${NC}"

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null || echo "not installed")
echo -e "   Node.js version: ${NODE_VERSION}"
if [[ ! "$NODE_VERSION" =~ ^v(18|19|20|21|22) ]]; then
    echo -e "${YELLOW}⚠️  Warning: Node.js 18+ recommended${NC}"
fi

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 is not installed. Installing PM2...${NC}"
    npm install -g pm2
fi
echo -e "   PM2 version: $(pm2 -v)"

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ ERROR: .env file not found!${NC}"
    echo -e "${YELLOW}   Please create .env file with staging configuration.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Pre-flight checks passed${NC}"

# ============================================================================
# Staging Environment Validation
# ============================================================================
echo ""
echo -e "${YELLOW}🔧 Validating staging settings...${NC}"

# Check NODE_ENV (staging should not be production)
if grep -q "NODE_ENV=production" .env; then
    echo -e "${YELLOW}⚠️  Warning: NODE_ENV is 'production' - consider using 'staging' for staging environment${NC}"
fi

# Warn about Mswipe mode
if grep -q 'MSWIPE_ENV="production"' .env || grep -q "MSWIPE_ENV='production'" .env || grep -q "MSWIPE_ENV=production" .env; then
    echo -e "${RED}⚠️  Warning: MSWIPE_ENV is 'production' - staging should use 'uat' for testing${NC}"
fi

echo -e "${GREEN}✅ Staging validation passed${NC}"

# ============================================================================
# Dependency Installation
# ============================================================================
echo ""
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
npm install --silent
echo -e "${GREEN}✅ Dependencies installed${NC}"

# ============================================================================
# Create Required Directories
# ============================================================================
echo ""
echo -e "${YELLOW}📁 Creating required directories...${NC}"
mkdir -p ${LOG_DIR}
chmod 755 ${LOG_DIR}
echo -e "${GREEN}✅ Directories created${NC}"

# ============================================================================
# Stop Existing Processes
# ============================================================================
echo ""
echo -e "${YELLOW}🛑 Stopping existing staging processes...${NC}"
pm2 delete ${APP_NAME} 2>/dev/null || true
pm2 delete ${CRON_NAME} 2>/dev/null || true
echo -e "${GREEN}✅ Existing processes stopped${NC}"

# ============================================================================
# Start Application in Staging Mode
# ============================================================================
echo ""
echo -e "${YELLOW}🚀 Starting application in STAGING mode...${NC}"

# Start using staging config
pm2 start ecosystem.staging.config.js --env staging

# Wait a moment for startup
sleep 3

# ============================================================================
# Health Check
# ============================================================================
echo ""
echo -e "${YELLOW}🏥 Running health check...${NC}"

# Check if process is running
if pm2 list | grep -q "${APP_NAME}.*online"; then
    echo -e "${GREEN}✅ Application is running${NC}"
else
    echo -e "${RED}❌ Application failed to start. Check logs:${NC}"
    pm2 logs ${APP_NAME} --lines 20
    exit 1
fi

# Check HTTP health
sleep 2
HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${PORT}/health 2>/dev/null || echo "000")
if [ "$HEALTH_CHECK" = "200" ]; then
    echo -e "${GREEN}✅ Health check passed (HTTP 200)${NC}"
elif [ "$HEALTH_CHECK" = "000" ]; then
    echo -e "${YELLOW}⚠️  Could not connect to health endpoint (may need a moment to start)${NC}"
else
    echo -e "${YELLOW}⚠️  Health check returned HTTP ${HEALTH_CHECK}${NC}"
fi

# ============================================================================
# Save PM2 Configuration
# ============================================================================
echo ""
echo -e "${YELLOW}💾 Saving PM2 configuration...${NC}"
pm2 save
echo -e "${GREEN}✅ PM2 configuration saved${NC}"

# ============================================================================
# Final Status
# ============================================================================
echo ""
echo -e "${CYAN}============================================================================${NC}"
echo -e "${GREEN}✅ STAGING DEPLOYMENT COMPLETE${NC}"
echo -e "${CYAN}============================================================================${NC}"
echo ""
echo -e "📊 Application Status:"
pm2 status

echo ""
echo -e "${BLUE}Useful Commands:${NC}"
echo -e "   View logs:     ${YELLOW}pm2 logs ${APP_NAME}${NC}"
echo -e "   Monitor:       ${YELLOW}pm2 monit${NC}"
echo -e "   Restart:       ${YELLOW}pm2 restart ${APP_NAME}${NC}"
echo -e "   Stop:          ${YELLOW}pm2 stop ${APP_NAME}${NC}"
echo ""
echo -e "${GREEN}🎉 Staging server is now running on port ${PORT}${NC}"
echo -e "${CYAN}🔗 Health check: curl http://localhost:${PORT}/health${NC}"
