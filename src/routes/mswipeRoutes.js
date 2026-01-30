const express = require('express');
const router = express.Router();
const mswipeController = require('../controllers/mswipeController');
const rateLimit = require('express-rate-limit');

/**
 * Rate limiter for payment initiation
 * Production: 5 requests per 15 minutes
 * Development/Testing: 50 requests per 15 minutes
 */
const isProduction = process.env.NODE_ENV === 'production';
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isProduction ? 5 : 50, // More lenient in dev/staging
  message: 'Too many payment requests from this IP, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for status/verify endpoints
 * More lenient: 30 requests per 15 minutes
 */
const statusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 requests per windowMs
  message: 'Too many status requests from this IP, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/mswipe/initiate
 * Initiate Mswipe payment for donation
 * 
 * Public endpoint - rate limited
 * Creates pending donation and returns Mswipe payment URL (smslink)
 * 
 * Request body:
 * {
 *   fullName: string,
 *   email: string,
 *   phoneNumber: string (10 digits),
 *   amount: number,
 *   state: string,
 *   city: string,
 *   pinCode: string (6 digits),
 *   address: string,
 *   seek80G: 'yes' | 'no',
 *   reasonForDonation: string (enum),
 *   purpose: string (optional),
 *   panCardNumber: string (optional)
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   paymentUrl: string (Mswipe smslink),
 *   donationRef: string,
 *   orderId: string
 * }
 */
router.post('/initiate', paymentLimiter, mswipeController.initiatePayment);

/**
 * POST /api/mswipe/callback
 * Webhook endpoint for Mswipe BackPosting callbacks
 * 
 * PUBLIC - No authentication (called by Mswipe servers)
 * Updates donation status based on payment result
 * Redirects to frontend payment result page
 * 
 * SECURITY:
 * - Only updates PENDING donations
 * - Verifies order ID (ME_InvNo) and amount
 * - Prevents replay attacks
 * 
 * Request body: Mswipe BackPosting format
 * {
 *   IPG_ID: string,
 *   ME_InvNo: string (our order ID),
 *   TRAN_STATUS: 'approved' | 'declined' | 'failed',
 *   TranAmount: string,
 *   RRN: string,
 *   CardType: string,
 *   ... (see Mswipe documentation)
 * }
 */
router.post('/callback', mswipeController.handleCallback);

/**
 * GET /api/mswipe/status/:donationRef
 * Get donation payment status by reference
 * 
 * Public endpoint - rate limited
 * Useful for frontend to check/poll status
 * 
 * Response:
 * {
 *   donationRef: string,
 *   status: 'PENDING' | 'SUCCESS' | 'FAILED',
 *   amount: number,
 *   transactionRef: string,
 *   ipgId: string,
 *   createdAt: Date,
 *   updatedAt: Date
 * }
 */
router.get('/status/:donationRef', statusLimiter, mswipeController.getDonationStatus);

/**
 * POST /api/mswipe/verify/:donationRef
 * Verify transaction status with Mswipe API
 * 
 * Use this endpoint to manually verify payment status
 * if callback was missed or for reconciliation
 * 
 * Calls Mswipe getPBLTransactionDetails API
 * Updates donation status if changed from PENDING
 * 
 * Response:
 * {
 *   donationRef: string,
 *   status: 'PENDING' | 'SUCCESS' | 'FAILED',
 *   mswipeStatus: { ... Mswipe API response },
 *   amount: number,
 *   transactionRef: string,
 *   updatedAt: Date
 * }
 */
router.post('/verify/:donationRef', statusLimiter, mswipeController.verifyTransaction);

/**
 * GET /api/mswipe/info
 * Get Mswipe service environment info (for debugging)
 * 
 * Returns current environment (UAT/Production), 
 * configuration status, and token status
 * 
 * Response:
 * {
 *   environment: 'uat' | 'production',
 *   baseUrl: string,
 *   configured: boolean,
 *   hasValidToken: boolean
 * }
 */
router.get('/info', mswipeController.getServiceInfo);

/**
 * GET /api/mswipe/debug/token
 * Debug endpoint to test Mswipe token generation
 * 
 * Helps verify if credentials are configured correctly
 * and if we can connect to Mswipe API
 * 
 * SECURITY: Only available in non-production environments
 */
if (process.env.NODE_ENV !== 'production') {
  router.get('/debug/token', mswipeController.debugTestToken);
}

module.exports = router;
