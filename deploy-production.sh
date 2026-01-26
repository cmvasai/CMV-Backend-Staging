#!/bin/bash

# ============================================================================
# CMV Backend - Production Deployment Script
# ============================================================================
# Usage: ./deploy-production.sh
# 
# This script deploys the CMV Backend to PRODUCTION environment.
# It ensures proper security settings, no debug logs, and production mode.
#
# Prerequisites:
# - Node.js 18+ installed
# - PM2 installed globally (npm install -g pm2)
# - .env.production file configured on server
# - Git configured with production remote
# ============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="cmv-production"
CRON_NAME="cmv-production-cron"
PORT=5001
LOG_DIR="./logs"

echo -e "${BLUE}============================================================================${NC}"
echo -e "${BLUE}     CMV Backend - Production Deployment${NC}"
echo -e "${BLUE}============================================================================${NC}"
echo ""

# ============================================================================
# Pre-flight Checks
# ============================================================================
echo -e "${YELLOW}🔍 Running pre-flight checks...${NC}"

# Check if running as root (not recommended)
if [ "$EUID" -eq 0 ]; then
    echo -e "${YELLOW}⚠️  Warning: Running as root is not recommended${NC}"
fi

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null || echo "not installed")
echo -e "   Node.js version: ${NODE_VERSION}"
if [[ ! "$NODE_VERSION" =~ ^v(18|19|20|21|22) ]]; then
    echo -e "${YELLOW}⚠️  Warning: Node.js 18+ recommended for production${NC}"
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
    echo -e "${YELLOW}   Please create .env file with production configuration.${NC}"
    echo -e "${YELLOW}   See .env.production.template for reference.${NC}"
    exit 1
fi

# ============================================================================
# Security Validation
# ============================================================================
echo ""
echo -e "${YELLOW}🔒 Validating production security settings...${NC}"

# Check NODE_ENV in .env
if grep -q "NODE_ENV=development" .env; then
    echo -e "${RED}❌ ERROR: NODE_ENV is set to 'development' in .env${NC}"
    echo -e "${YELLOW}   Please set NODE_ENV=production${NC}"
    exit 1
fi

# Check for debug flags
if grep -q "DEBUG_CORS=true" .env; then
    echo -e "${RED}❌ ERROR: DEBUG_CORS is enabled in .env${NC}"
    echo -e "${YELLOW}   Please set DEBUG_CORS=false for production${NC}"
    exit 1
fi

if grep -q "DEBUG=true" .env; then
    echo -e "${RED}❌ ERROR: DEBUG is enabled in .env${NC}"
    echo -e "${YELLOW}   Please set DEBUG=false for production${NC}"
    exit 1
fi

# Check for localhost URLs (warning only)
if grep -q "localhost" .env; then
    echo -e "${YELLOW}⚠️  Warning: Found 'localhost' in .env - ensure URLs are production URLs${NC}"
fi

# Check Mswipe production mode
if grep -q 'MSWIPE_ENV="uat"' .env || grep -q "MSWIPE_ENV='uat'" .env; then
    echo -e "${YELLOW}⚠️  Warning: MSWIPE_ENV is set to 'uat' - change to 'production' for live payments${NC}"
fi

echo -e "${GREEN}✅ Security validation passed${NC}"

# ============================================================================
# Dependency Installation
# ============================================================================
echo ""
echo -e "${YELLOW}📦 Installing production dependencies...${NC}"
npm ci --production --silent 2>/dev/null || npm install --production --silent
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
echo -e "${YELLOW}🛑 Stopping existing processes...${NC}"
pm2 delete ${APP_NAME} 2>/dev/null || true
pm2 delete ${CRON_NAME} 2>/dev/null || true
echo -e "${GREEN}✅ Existing processes stopped${NC}"

# ============================================================================
# Start Application in Production Mode
# ============================================================================
echo ""
echo -e "${YELLOW}🚀 Starting application in PRODUCTION mode...${NC}"

# Start main server
pm2 start ecosystem.production.config.js --env production

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

# Check HTTP health (if health endpoint exists)
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
# Setup PM2 Startup (run once on new server)
# ============================================================================
echo ""
echo -e "${YELLOW}ℹ️  To enable auto-start on server reboot, run:${NC}"
echo -e "   ${BLUE}pm2 startup${NC}"
echo -e "   Then copy and run the command it outputs"

# ============================================================================
# Final Status
# ============================================================================
echo ""
echo -e "${BLUE}============================================================================${NC}"
echo -e "${GREEN}✅ PRODUCTION DEPLOYMENT COMPLETE${NC}"
echo -e "${BLUE}============================================================================${NC}"
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
echo -e "${GREEN}🎉 Production server is now running on port ${PORT}${NC}"
