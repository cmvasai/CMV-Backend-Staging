/**
 * Trivia Attempt Model
 * 
 * Stores user trivia quiz attempts with phone verification status,
 * quiz answers, and scores for the Chinmaya Amrit Mahotsav trivia.
 */

const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  question: {
    type: String,
    required: true
  },
  selectedAnswer: {
    type: String,
    required: true
  },
  correctAnswer: {
    type: String,
    required: true
  },
  isCorrect: {
    type: Boolean,
    default: null  // null for opinion questions (q4, q5)
  }
}, { _id: false });

const triviaAttemptSchema = new mongoose.Schema({
  // Auto-generated attempt ID
  attemptId: {
    type: String,
    unique: true
  },

  // User details
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    minlength: [2, 'Name must be at least 2 characters'],
    maxlength: [100, 'Name cannot exceed 100 characters']
  },

  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true,
    validate: {
      validator: function(v) {
        // 10-digit Indian mobile number starting with 6, 7, 8, or 9
        return /^[6-9]\d{9}$/.test(v);
      },
      message: 'Please enter a valid 10-digit Indian mobile number'
    }
  },

  // Verification status
  isVerified: {
    type: Boolean,
    default: false
  },

  verifiedAt: {
    type: Date
  },

  // Quiz attempt details
  hasAttempted: {
    type: Boolean,
    default: false
  },

  score: {
    type: Number,
    min: 0,
    default: null
  },

  totalQuestions: {
    type: Number,
    default: 5
  },

  answers: [answerSchema],

  // Interest questions
  isExcitedAboutVedanta: {
    type: String,
    enum: ['YES', 'NO', 'MAYBE', null],
    default: null
  },

  wantsFreeGitaSession: {
    type: String,
    enum: ['YES', 'NO', 'MAYBE', null],
    default: null
  },

  // Timestamps
  attemptedAt: {
    type: Date
  },

  // IP address for tracking (optional)
  ipAddress: {
    type: String
  }

}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Index for faster queries
triviaAttemptSchema.index({ phoneNumber: 1 });
triviaAttemptSchema.index({ isVerified: 1 });
triviaAttemptSchema.index({ hasAttempted: 1 });
triviaAttemptSchema.index({ createdAt: -1 });

// Pre-save middleware to generate attemptId
triviaAttemptSchema.pre('save', async function(next) {
  if (this.isNew && !this.attemptId) {
    try {
      // Generate unique attempt ID: TRIV-YYYYMMDD-XXXXX
      const date = new Date();
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
      
      // Find the count of attempts today for sequential numbering
      const todayStart = new Date(date.setHours(0, 0, 0, 0));
      const todayEnd = new Date(date.setHours(23, 59, 59, 999));
      
      const count = await mongoose.model('TriviaAttempt').countDocuments({
        createdAt: { $gte: todayStart, $lte: todayEnd }
      });
      
      const sequentialNumber = String(count + 1).padStart(5, '0');
      this.attemptId = `TRIV-${dateStr}-${sequentialNumber}`;
    } catch (error) {
      // Fallback to random ID if count fails
      const randomNum = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      this.attemptId = `TRIV-${dateStr}-${randomNum}`;
    }
  }
  next();
});

// Instance method to check if quiz can be submitted
triviaAttemptSchema.methods.canSubmitQuiz = function() {
  return this.isVerified && !this.hasAttempted;
};

// Instance method to calculate and set score
triviaAttemptSchema.methods.calculateScore = function() {
  if (!this.answers || this.answers.length === 0) {
    this.score = 0;
    return 0;
  }
  
  const correctCount = this.answers.filter(a => a.isCorrect).length;
  this.score = correctCount;
  return correctCount;
};

// Static method to find by phone number
triviaAttemptSchema.statics.findByPhone = function(phoneNumber) {
  const cleanedPhone = phoneNumber.replace(/[\s\-]/g, '').replace(/^\+91/, '');
  return this.findOne({ phoneNumber: cleanedPhone });
};

// Static method to get verified attempts for export
triviaAttemptSchema.statics.getVerifiedAttempts = function(options = {}) {
  const query = { isVerified: true };
  
  if (options.hasAttempted !== undefined) {
    query.hasAttempted = options.hasAttempted;
  }
  
  if (options.startDate && options.endDate) {
    query.createdAt = {
      $gte: new Date(options.startDate),
      $lte: new Date(options.endDate)
    };
  }
  
  return this.find(query).sort({ createdAt: -1 });
};

// Static method to get statistics
triviaAttemptSchema.statics.getStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: null,
        totalRegistrations: { $sum: 1 },
        verifiedUsers: { $sum: { $cond: ['$isVerified', 1, 0] } },
        completedQuizzes: { $sum: { $cond: ['$hasAttempted', 1, 0] } },
        averageScore: { 
          $avg: { 
            $cond: [{ $gt: ['$score', null] }, '$score', null] 
          } 
        },
        wantGitaSession: {
          $sum: { $cond: [{ $eq: ['$wantsFreeGitaSession', 'YES'] }, 1, 0] }
        },
        excitedAboutVedanta: {
          $sum: { $cond: [{ $eq: ['$isExcitedAboutVedanta', 'YES'] }, 1, 0] }
        }
      }
    }
  ]);
  
  return stats[0] || {
    totalRegistrations: 0,
    verifiedUsers: 0,
    completedQuizzes: 0,
    averageScore: 0,
    wantGitaSession: 0,
    excitedAboutVedanta: 0
  };
};

const TriviaAttempt = mongoose.model('TriviaAttempt', triviaAttemptSchema);

module.exports = TriviaAttempt;
