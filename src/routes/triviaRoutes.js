/**
 * Trivia Quiz Routes
 * 
 * API endpoints for the Chinmaya Amrit Mahotsav trivia quiz
 * with SMS OTP verification via 2Factor
 */

const express = require('express');
const router = express.Router();
const triviaController = require('../controllers/triviaController');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

// ============================================================================
// Rate Limiters
// ============================================================================

// Rate limiting for OTP endpoints (stricter to prevent SMS abuse)
const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 OTP requests per 15 minutes
  message: {
    success: false,
    message: 'Too many OTP requests. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for local development
    return process.env.NODE_ENV === 'development' || req.ip === '::1' || req.ip === '127.0.0.1';
  }
});

// Rate limiting for quiz submission
const submitRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 submissions per 15 minutes
  message: {
    success: false,
    message: 'Too many submission attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return process.env.NODE_ENV === 'development' || req.ip === '::1' || req.ip === '127.0.0.1';
  }
});

// Rate limiting for general endpoints
const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 requests per 15 minutes
  message: {
    success: false,
    message: 'Too many requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return process.env.NODE_ENV === 'development' || req.ip === '::1' || req.ip === '127.0.0.1';
  }
});

// ============================================================================
// Request Logging Middleware
// ============================================================================

router.use((req, res, next) => {
  logger.info(`Trivia route accessed: ${req.method} ${req.originalUrl} from ${req.ip}`);
  next();
});

// ============================================================================
// Public Routes
// ============================================================================

/**
 * @route   GET /api/trivia/questions
 * @desc    Get quiz questions (without correct answers)
 * @access  Public
 */
router.get('/questions', generalRateLimit, triviaController.getQuestions);

/**
 * @route   POST /api/trivia/initiate
 * @desc    Register user with name/phone and send OTP
 * @access  Public
 * @body    { name: string, phoneNumber: string }
 */
router.post('/initiate', otpRateLimit, triviaController.initiateQuiz);

/**
 * @route   POST /api/trivia/resend-otp
 * @desc    Resend OTP (60-second cooldown enforced)
 * @access  Public
 * @body    { phoneNumber: string }
 */
router.post('/resend-otp', otpRateLimit, triviaController.resendOTP);

/**
 * @route   POST /api/trivia/verify-otp
 * @desc    Verify OTP and mark user as verified
 * @access  Public
 * @body    { phoneNumber: string, otp: string }
 */
router.post('/verify-otp', generalRateLimit, triviaController.verifyOTP);

/**
 * @route   POST /api/trivia/submit
 * @desc    Submit quiz answers and calculate score
 * @access  Public (requires verified phone)
 * @body    { phoneNumber: string, answers: [{ questionId: string, selectedAnswer: string }] }
 */
router.post('/submit', submitRateLimit, triviaController.submitQuiz);

/**
 * @route   GET /api/trivia/status/:phoneNumber
 * @desc    Get user's attempt status by phone number
 * @access  Public
 */
router.get('/status/:phoneNumber', generalRateLimit, triviaController.getStatus);

// ============================================================================
// Admin Routes (No authentication for consistency with existing admin routes)
// ============================================================================

/**
 * @route   GET /api/trivia/stats
 * @desc    Get trivia quiz statistics
 * @access  Admin
 */
router.get('/stats', triviaController.getStats);

/**
 * @route   GET /api/trivia/export
 * @desc    Export all trivia attempts to CSV
 * @access  Admin
 * @query   startDate, endDate, onlyCompleted (optional)
 */
router.get('/export', triviaController.exportCSV);

module.exports = router;
