/**
 * Trivia Controller
 * 
 * Handles trivia quiz flow:
 * 1. Initiate - User registers with name/phone, OTP is sent
 * 2. Resend OTP - Resend OTP after 60s cooldown
 * 3. Verify OTP - Verify phone number
 * 4. Submit Quiz - Submit quiz answers and calculate score
 * 5. Export - Admin export of all attempts to CSV
 */

const TriviaAttempt = require('../models/TriviaAttempt');
const smsOtpService = require('../services/smsOtpService');
const logger = require('../utils/logger');
const { Parser } = require('json2csv');

// Correct answers for the trivia quiz (stored securely on backend)
const TRIVIA_QUESTIONS = {
  questions: [
    {
      id: 'q1',
      question: 'When was Chinmaya Mission founded?',
      options: ['1953', '1921', '1935'],
      correctAnswer: '1953'
    },
    {
      id: 'q2',
      question: 'Who founded Chinmaya Mission?',
      options: [
        'HH SWAMI Swaroopanandji',
        'HH SWAMI VIVEKANANDAJI',
        'HH SWAMI CHINMAYANANDA SARASWATI'
      ],
      correctAnswer: 'HH SWAMI CHINMAYANANDA SARASWATI'
    },
    {
      id: 'q3',
      question: 'Which mahotsav is Chinmaya Mission celebrating?',
      options: [
        'VEDANTA MAHOTSAV',
        'RATH YATRA MAHOTSAV',
        'CHINMAYA AMRIT MAHOTSAV'
      ],
      correctAnswer: 'CHINMAYA AMRIT MAHOTSAV'
    },
    {
      id: 'q4',
      question: 'Does Vedanta excite you?',
      options: ['YES', 'NO', 'MAYBE'],
      correctAnswer: null // No correct answer - opinion question
    },
    {
      id: 'q5',
      question: 'Do you want a free Gita session?',
      options: ['YES', 'NO', 'MAYBE'],
      correctAnswer: null // No correct answer - opinion question
    }
  ],
  totalScoredQuestions: 3 // Only first 3 questions count towards score
};

class TriviaController {
  /**
   * Get quiz questions (without correct answers)
   * GET /api/trivia/questions
   */
  async getQuestions(req, res) {
    try {
      // Return questions without correct answers
      const questionsForClient = TRIVIA_QUESTIONS.questions.map(q => ({
        id: q.id,
        question: q.question,
        options: q.options
      }));

      return res.status(200).json({
        success: true,
        data: {
          questions: questionsForClient,
          totalQuestions: TRIVIA_QUESTIONS.questions.length,
          scoredQuestions: TRIVIA_QUESTIONS.totalScoredQuestions
        }
      });
    } catch (error) {
      logger.error('Error fetching questions:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch quiz questions.'
      });
    }
  }

  /**
   * Initiate quiz - Register user and send OTP
   * POST /api/trivia/initiate
   * Body: { name, phoneNumber }
   */
  async initiateQuiz(req, res) {
    try {
      const { name, phoneNumber } = req.body;

      // Validation
      const errors = [];
      
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        errors.push('Name is required and must be at least 2 characters.');
      }
      
      if (!phoneNumber) {
        errors.push('Phone number is required.');
      } else if (!smsOtpService.validatePhoneNumber(phoneNumber)) {
        errors.push('Please enter a valid 10-digit Indian mobile number.');
      }

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed.',
          errors
        });
      }

      const cleanedPhone = smsOtpService.cleanPhoneNumber(phoneNumber);
      const trimmedName = name.trim();

      // Check if phone number already exists
      let attempt = await TriviaAttempt.findByPhone(cleanedPhone);

      if (attempt) {
        // If already verified and attempted quiz
        if (attempt.isVerified && attempt.hasAttempted) {
          return res.status(400).json({
            success: false,
            message: 'You have already completed the trivia quiz.',
            data: {
              attemptId: attempt.attemptId,
              score: attempt.score,
              totalQuestions: TRIVIA_QUESTIONS.totalScoredQuestions
            }
          });
        }

        // If verified but not attempted, allow to continue
        if (attempt.isVerified && !attempt.hasAttempted) {
          return res.status(200).json({
            success: true,
            message: 'Phone already verified. You can proceed to the quiz.',
            data: {
              attemptId: attempt.attemptId,
              isVerified: true,
              canAttemptQuiz: true
            }
          });
        }

        // If not verified, resend OTP
        // Update name if different
        if (attempt.name !== trimmedName) {
          attempt.name = trimmedName;
          await attempt.save();
        }
      } else {
        // Create new attempt record
        attempt = new TriviaAttempt({
          name: trimmedName,
          phoneNumber: cleanedPhone,
          ipAddress: req.ip || req.connection?.remoteAddress
        });
        await attempt.save();
        logger.info(`New trivia registration: ${attempt.attemptId} - ${cleanedPhone.substring(0, 4)}****`);
      }

      // Send OTP
      const otpResult = await smsOtpService.sendOTP(cleanedPhone);

      if (!otpResult.success) {
        return res.status(400).json({
          success: false,
          message: otpResult.message,
          remainingSeconds: otpResult.remainingSeconds || null
        });
      }

      return res.status(200).json({
        success: true,
        message: 'OTP sent successfully to your phone number via SMS.',
        data: {
          attemptId: attempt.attemptId,
          phoneNumber: `${cleanedPhone.substring(0, 4)}****${cleanedPhone.substring(8)}`,
          isVerified: false,  // Explicit flag - user needs to verify OTP
          requiresOTP: true,  // Frontend should show OTP screen
          cooldownSeconds: 60
        }
      });

    } catch (error) {
      logger.error('Initiate quiz error:', error);
      
      // Handle duplicate key error
      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message: 'This phone number is already registered. Please use a different number or contact support.'
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Failed to initiate quiz. Please try again.'
      });
    }
  }

  /**
   * Resend OTP with 60-second cooldown
   * POST /api/trivia/resend-otp
   * Body: { phoneNumber }
   */
  async resendOTP(req, res) {
    try {
      const { phoneNumber } = req.body;

      if (!phoneNumber || !smsOtpService.validatePhoneNumber(phoneNumber)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid 10-digit phone number.'
        });
      }

      const cleanedPhone = smsOtpService.cleanPhoneNumber(phoneNumber);

      // Check if user exists
      const attempt = await TriviaAttempt.findByPhone(cleanedPhone);
      if (!attempt) {
        return res.status(404).json({
          success: false,
          message: 'No registration found for this phone number. Please start the registration process.'
        });
      }

      // If already verified
      if (attempt.isVerified) {
        return res.status(400).json({
          success: false,
          message: 'Phone number is already verified.',
          data: {
            attemptId: attempt.attemptId,
            isVerified: true,
            canAttemptQuiz: !attempt.hasAttempted
          }
        });
      }

      // Check cooldown
      const cooldownStatus = smsOtpService.canResend(cleanedPhone);
      if (!cooldownStatus.canResend) {
        return res.status(429).json({
          success: false,
          message: `Please wait ${cooldownStatus.remainingSeconds} seconds before requesting a new OTP.`,
          remainingSeconds: cooldownStatus.remainingSeconds
        });
      }

      // Send OTP
      const otpResult = await smsOtpService.sendOTP(cleanedPhone);

      if (!otpResult.success) {
        return res.status(400).json({
          success: false,
          message: otpResult.message,
          remainingSeconds: otpResult.remainingSeconds || null
        });
      }

      return res.status(200).json({
        success: true,
        message: 'OTP resent successfully.',
        data: {
          phoneNumber: `${cleanedPhone.substring(0, 4)}****${cleanedPhone.substring(8)}`,
          cooldownSeconds: 60
        }
      });

    } catch (error) {
      logger.error('Resend OTP error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to resend OTP. Please try again.'
      });
    }
  }

  /**
   * Verify OTP
   * POST /api/trivia/verify-otp
   * Body: { phoneNumber, otp }
   */
  async verifyOTP(req, res) {
    try {
      const { phoneNumber, otp } = req.body;

      // Validation
      if (!phoneNumber || !smsOtpService.validatePhoneNumber(phoneNumber)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid phone number.'
        });
      }

      if (!otp || !/^\d{4,6}$/.test(otp)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid OTP.'
        });
      }

      const cleanedPhone = smsOtpService.cleanPhoneNumber(phoneNumber);

      // Check if user exists
      const attempt = await TriviaAttempt.findByPhone(cleanedPhone);
      if (!attempt) {
        return res.status(404).json({
          success: false,
          message: 'No registration found. Please start the registration process.'
        });
      }

      // If already verified
      if (attempt.isVerified) {
        return res.status(200).json({
          success: true,
          message: 'Phone number is already verified.',
          data: {
            attemptId: attempt.attemptId,
            name: attempt.name,
            isVerified: true,
            canAttemptQuiz: !attempt.hasAttempted,
            hasAttempted: attempt.hasAttempted,
            score: attempt.hasAttempted ? attempt.score : null
          }
        });
      }

      // Verify OTP with 2Factor
      const verifyResult = await smsOtpService.verifyOTP(cleanedPhone, otp);

      if (!verifyResult.success) {
        return res.status(400).json({
          success: false,
          message: verifyResult.message
        });
      }

      // Update verification status
      attempt.isVerified = true;
      attempt.verifiedAt = new Date();
      await attempt.save();

      logger.info(`Phone verified for trivia: ${attempt.attemptId}`);

      return res.status(200).json({
        success: true,
        message: 'Phone number verified successfully. You can now attempt the quiz.',
        data: {
          attemptId: attempt.attemptId,
          name: attempt.name,
          isVerified: true,
          canAttemptQuiz: true
        }
      });

    } catch (error) {
      logger.error('Verify OTP error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to verify OTP. Please try again.'
      });
    }
  }

  /**
   * Submit quiz answers
   * POST /api/trivia/submit
   * Body: { phoneNumber, answers: [{ questionId, selectedAnswer }] }
   */
  async submitQuiz(req, res) {
    try {
      const { phoneNumber, answers } = req.body;

      // Validation
      if (!phoneNumber || !smsOtpService.validatePhoneNumber(phoneNumber)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid phone number.'
        });
      }

      if (!answers || !Array.isArray(answers) || answers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please provide quiz answers.'
        });
      }

      const cleanedPhone = smsOtpService.cleanPhoneNumber(phoneNumber);

      // Find user
      const attempt = await TriviaAttempt.findByPhone(cleanedPhone);
      if (!attempt) {
        return res.status(404).json({
          success: false,
          message: 'No registration found. Please register first.'
        });
      }

      // Check if verified
      if (!attempt.isVerified) {
        return res.status(403).json({
          success: false,
          message: 'Please verify your phone number before submitting the quiz.'
        });
      }

      // Check if already attempted
      if (attempt.hasAttempted) {
        return res.status(400).json({
          success: false,
          message: 'You have already submitted the quiz.',
          data: {
            attemptId: attempt.attemptId,
            score: attempt.score,
            totalQuestions: TRIVIA_QUESTIONS.totalScoredQuestions
          }
        });
      }

      // Process answers
      const processedAnswers = [];
      let score = 0;

      for (const question of TRIVIA_QUESTIONS.questions) {
        const userAnswer = answers.find(a => a.questionId === question.id);
        const selectedAnswer = userAnswer?.selectedAnswer || 'Not answered';
        
        // Normalize answers for comparison (trim and uppercase)
        const normalizedSelected = selectedAnswer.toString().trim().toUpperCase();
        const normalizedCorrect = question.correctAnswer?.toString().trim().toUpperCase();
        
        const isCorrect = question.correctAnswer !== null && 
                          normalizedSelected === normalizedCorrect;
        
        if (isCorrect) {
          score++;
        }

        processedAnswers.push({
          question: question.question,
          selectedAnswer: selectedAnswer,
          correctAnswer: question.correctAnswer || 'N/A',
          isCorrect: question.correctAnswer !== null ? isCorrect : null
        });

        // Store interest question responses
        if (question.id === 'q4') {
          attempt.isExcitedAboutVedanta = selectedAnswer.toUpperCase();
        }
        if (question.id === 'q5') {
          attempt.wantsFreeGitaSession = selectedAnswer.toUpperCase();
        }
      }

      // Update attempt
      attempt.hasAttempted = true;
      attempt.score = score;
      attempt.answers = processedAnswers;
      attempt.attemptedAt = new Date();
      await attempt.save();

      logger.info(`Quiz submitted: ${attempt.attemptId} - Score: ${score}/${TRIVIA_QUESTIONS.totalScoredQuestions}`);

      return res.status(200).json({
        success: true,
        message: 'Quiz submitted successfully!',
        data: {
          attemptId: attempt.attemptId,
          name: attempt.name,
          score: score,
          totalQuestions: TRIVIA_QUESTIONS.totalScoredQuestions,
          answers: processedAnswers.map(a => ({
            question: a.question,
            yourAnswer: a.selectedAnswer,
            correctAnswer: a.correctAnswer,
            isCorrect: a.isCorrect
          }))
        }
      });

    } catch (error) {
      logger.error('Submit quiz error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to submit quiz. Please try again.'
      });
    }
  }

  /**
   * Get quiz statistics (Admin)
   * GET /api/trivia/stats
   */
  async getStats(req, res) {
    try {
      const stats = await TriviaAttempt.getStats();

      return res.status(200).json({
        success: true,
        data: {
          totalRegistrations: stats.totalRegistrations,
          verifiedUsers: stats.verifiedUsers,
          completedQuizzes: stats.completedQuizzes,
          averageScore: stats.averageScore ? stats.averageScore.toFixed(2) : 0,
          wantGitaSession: stats.wantGitaSession,
          excitedAboutVedanta: stats.excitedAboutVedanta
        }
      });

    } catch (error) {
      logger.error('Get stats error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch statistics.'
      });
    }
  }

  /**
   * Export trivia attempts to CSV (Admin)
   * GET /api/trivia/export
   * Query: startDate, endDate, onlyCompleted (optional)
   */
  async exportCSV(req, res) {
    try {
      const { startDate, endDate, onlyCompleted } = req.query;

      // Build query
      const query = {};
      
      if (onlyCompleted === 'true') {
        query.hasAttempted = true;
      }

      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) {
          query.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          query.createdAt.$lte = end;
        }
      }

      const attempts = await TriviaAttempt.find(query)
        .sort({ createdAt: -1 })
        .lean();

      if (attempts.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No trivia attempts found for the specified criteria.'
        });
      }

      // Transform data for CSV
      const csvData = attempts.map(attempt => ({
        'Attempt ID': attempt.attemptId,
        'Name': attempt.name,
        'Phone Number': attempt.phoneNumber,
        'Is Verified': attempt.isVerified ? 'Yes' : 'No',
        'Verified At': attempt.verifiedAt ? new Date(attempt.verifiedAt).toLocaleString('en-IN') : '',
        'Quiz Completed': attempt.hasAttempted ? 'Yes' : 'No',
        'Score': attempt.score !== null ? `${attempt.score}/${TRIVIA_QUESTIONS.totalScoredQuestions}` : '',
        'Excited About Vedanta': attempt.isExcitedAboutVedanta || '',
        'Wants Free Gita Session': attempt.wantsFreeGitaSession || '',
        'Q1: Year Founded': attempt.answers?.[0]?.selectedAnswer || '',
        'Q1 Correct': attempt.answers?.[0]?.isCorrect ? 'Yes' : 'No',
        'Q2: Founder': attempt.answers?.[1]?.selectedAnswer || '',
        'Q2 Correct': attempt.answers?.[1]?.isCorrect ? 'Yes' : 'No',
        'Q3: Mahotsav': attempt.answers?.[2]?.selectedAnswer || '',
        'Q3 Correct': attempt.answers?.[2]?.isCorrect ? 'Yes' : 'No',
        'Registration Date': new Date(attempt.createdAt).toLocaleString('en-IN'),
        'Quiz Submitted At': attempt.attemptedAt ? new Date(attempt.attemptedAt).toLocaleString('en-IN') : ''
      }));

      // Generate CSV
      const fields = Object.keys(csvData[0]);
      const json2csvParser = new Parser({ fields });
      const csv = json2csvParser.parse(csvData);

      // Generate filename
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `trivia-attempts-${timestamp}.csv`;

      // Send CSV response
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      logger.info(`Trivia CSV exported: ${attempts.length} records`);

      return res.status(200).send(csv);

    } catch (error) {
      logger.error('Export CSV error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to export trivia data.'
      });
    }
  }

  /**
   * Get user's attempt status by phone
   * GET /api/trivia/status/:phoneNumber
   */
  async getStatus(req, res) {
    try {
      const { phoneNumber } = req.params;

      if (!phoneNumber || !smsOtpService.validatePhoneNumber(phoneNumber)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid phone number.'
        });
      }

      const cleanedPhone = smsOtpService.cleanPhoneNumber(phoneNumber);
      const attempt = await TriviaAttempt.findByPhone(cleanedPhone);

      if (!attempt) {
        return res.status(404).json({
          success: false,
          message: 'No registration found for this phone number.'
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          attemptId: attempt.attemptId,
          name: attempt.name,
          isVerified: attempt.isVerified,
          hasAttempted: attempt.hasAttempted,
          canAttemptQuiz: attempt.isVerified && !attempt.hasAttempted,
          score: attempt.hasAttempted ? attempt.score : null,
          totalQuestions: TRIVIA_QUESTIONS.totalScoredQuestions
        }
      });

    } catch (error) {
      logger.error('Get status error:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to get status.'
      });
    }
  }
}

module.exports = new TriviaController();
