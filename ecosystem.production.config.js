/**
 * PM2 Ecosystem Configuration - PRODUCTION
 * 
 * This configuration is optimized for production deployment:
 * - Cluster mode for multi-core utilization
 * - Higher memory limits
 * - Proper log rotation
 * - Auto-restart on failure
 * - No watching (for security)
 */

module.exports = {
  apps: [
    {
      // Main API Server
      name: 'cmv-production',
      script: 'src/server.js',
      
      // Cluster mode - use all available CPU cores
      instances: 'max',
      exec_mode: 'cluster',
      
      // Environment
      env_production: {
        NODE_ENV: 'production',
        PORT: 5001
      },
      
      // Memory & Restart Settings
      max_memory_restart: '1G',
      min_uptime: '30s',        // Consider app started after 30s
      max_restarts: 10,          // Max restarts within min_uptime
      restart_delay: 5000,       // 5s delay between restarts
      
      // Logging - Production optimized
      error_file: './logs/production-err.log',
      out_file: './logs/production-out.log',
      log_file: './logs/production-combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,          // Merge logs from all instances
      
      // Log rotation (requires pm2-logrotate)
      // Install: pm2 install pm2-logrotate
      // Configure: pm2 set pm2-logrotate:max_size 50M
      //            pm2 set pm2-logrotate:retain 10
      
      // Security - IMPORTANT for production
      watch: false,              // NEVER watch in production
      ignore_watch: ['node_modules', 'logs', '.git', '*.log'],
      
      // Auto-restart
      autorestart: true,
      
      // Graceful shutdown
      kill_timeout: 5000,        // 5s to gracefully shutdown
      listen_timeout: 10000,     // 10s to wait for app to listen
      
      // Source maps for error tracking (optional)
      source_map_support: true,
      
      // Instance identification
      instance_var: 'INSTANCE_ID'
    },
    
    {
      // Cron Job - Email Export (runs on 25th of each month)
      name: 'cmv-production-cron',
      script: 'src/jobs/emailExportJob.js',
      
      // Single instance for cron jobs
      instances: 1,
      exec_mode: 'fork',
      
      // Environment
      env_production: {
        NODE_ENV: 'production'
      },
      
      // Cron schedule - 25th of every month at midnight
      cron_restart: '0 0 25 * *',
      
      // Logging
      error_file: './logs/production-cron-err.log',
      out_file: './logs/production-cron-out.log',
      log_file: './logs/production-cron-combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Settings
      watch: false,
      autorestart: true,
      max_restarts: 5,
      min_uptime: '10s'
    }
  ],
  
  // Deployment configuration (optional - for pm2 deploy)
  deploy: {
    production: {
      user: 'ubuntu',
      host: 'your-production-server-ip',
      ref: 'origin/master',
      repo: 'git@github.com:Shreyas75/cmv-backend.git',
      path: '/home/ubuntu/cmv-backend',
      'pre-deploy': 'git fetch --all',
      'post-deploy': 'npm ci --production && pm2 reload ecosystem.production.config.js --env production',
      env: {
        NODE_ENV: 'production'
      }
    }
  }
};
