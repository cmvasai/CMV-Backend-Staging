# Trivia Quiz Frontend Integration Guide

Complete guide for integrating the Chinmaya Amrit Mahotsav Trivia Quiz with SMS OTP verification.

---

## Table of Contents

1. [Overview](#overview)
2. [User Flow](#user-flow)
3. [API Base URL](#api-base-url)
4. [API Endpoints](#api-endpoints)
5. [Step-by-Step Integration](#step-by-step-integration)
6. [Error Handling](#error-handling)
7. [React Example Implementation](#react-example-implementation)
8. [State Management](#state-management)
9. [UI/UX Recommendations](#uiux-recommendations)

---

## Overview

The trivia quiz flow consists of 4 steps:
1. **Registration** - User enters name and phone number
2. **OTP Verification** - User verifies phone via SMS OTP (60-second resend cooldown)
3. **Quiz Attempt** - User answers 5 trivia questions
4. **Results** - User sees their score and correct answers

---

## User Flow

```
┌─────────────────┐
│  Registration   │
│  (Name + Phone) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Send OTP      │◄──────────────┐
│   (2Factor SMS) │               │
└────────┬────────┘               │
         │                        │
         ▼                        │
┌─────────────────┐    ┌──────────┴─────────┐
│  Enter OTP      │───►│  Resend OTP        │
│  (6 digits)     │    │  (after 60 seconds)│
└────────┬────────┘    └────────────────────┘
         │
         ▼
┌─────────────────┐
│  Quiz Screen    │
│  (5 Questions)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Results Screen │
│  (Score + Ans)  │
└─────────────────┘
```

---

## API Base URL

```
Development: http://localhost:5001/api/trivia
Staging:     https://your-staging-domain.com/api/trivia
Production:  https://your-production-domain.com/api/trivia
```

---

## API Endpoints

### 1. Get Quiz Questions

Fetch questions to display (correct answers are NOT included).

```http
GET /api/trivia/questions
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "questions": [
      {
        "id": "q1",
        "question": "When was Chinmaya Mission founded?",
        "options": ["1953", "1921", "1935"]
      },
      {
        "id": "q2",
        "question": "Who founded Chinmaya Mission?",
        "options": [
          "HH SWAMI Swaroopanandji",
          "HH SWAMI VIVEKANANDAJI",
          "HH SWAMI CHINMAYANANDA SARASWATI"
        ]
      },
      {
        "id": "q3",
        "question": "Which mahotsav is Chinmaya Mission celebrating?",
        "options": [
          "VEDANTA MAHOTSAV",
          "RATH YATRA MAHOTSAV",
          "CHINMAYA AMRIT MAHOTSAV"
        ]
      },
      {
        "id": "q4",
        "question": "Does Vedanta excite you?",
        "options": ["YES", "NO", "MAYBE"]
      },
      {
        "id": "q5",
        "question": "Do you want a free Gita session?",
        "options": ["YES", "NO", "MAYBE"]
      }
    ],
    "totalQuestions": 5,
    "scoredQuestions": 3
  }
}
```

---

### 2. Initiate Quiz (Send OTP)

Register user and send OTP to their phone number.

```http
POST /api/trivia/initiate
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "John Doe",
  "phoneNumber": "9876543210"
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "OTP sent successfully to your phone number.",
  "data": {
    "attemptId": "TRIV-20260130-00001",
    "phoneNumber": "9876****10",
    "cooldownSeconds": 60
  }
}
```

**Error Responses:**

*Validation Error (400):*
```json
{
  "success": false,
  "message": "Validation failed.",
  "errors": [
    "Name is required and must be at least 2 characters.",
    "Please enter a valid 10-digit Indian mobile number."
  ]
}
```

*Already Completed (400):*
```json
{
  "success": false,
  "message": "You have already completed the trivia quiz.",
  "data": {
    "attemptId": "TRIV-20260130-00001",
    "score": 3,
    "totalQuestions": 3
  }
}
```

*Already Verified (200):*
```json
{
  "success": true,
  "message": "Phone already verified. You can proceed to the quiz.",
  "data": {
    "attemptId": "TRIV-20260130-00001",
    "isVerified": true,
    "canAttemptQuiz": true
  }
}
```

*Cooldown Active (400):*
```json
{
  "success": false,
  "message": "Please wait 45 seconds before requesting a new OTP.",
  "remainingSeconds": 45
}
```

---

### 3. Resend OTP

Resend OTP after 60-second cooldown.

```http
POST /api/trivia/resend-otp
Content-Type: application/json
```

**Request Body:**
```json
{
  "phoneNumber": "9876543210"
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "OTP resent successfully.",
  "data": {
    "phoneNumber": "9876****10",
    "cooldownSeconds": 60
  }
}
```

**Cooldown Error (429 Too Many Requests):**
```json
{
  "success": false,
  "message": "Please wait 35 seconds before requesting a new OTP.",
  "remainingSeconds": 35
}
```

---

### 4. Verify OTP

Verify the OTP entered by user.

```http
POST /api/trivia/verify-otp
Content-Type: application/json
```

**Request Body:**
```json
{
  "phoneNumber": "9876543210",
  "otp": "123456"
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Phone number verified successfully. You can now attempt the quiz.",
  "data": {
    "attemptId": "TRIV-20260130-00001",
    "name": "John Doe",
    "isVerified": true,
    "canAttemptQuiz": true
  }
}
```

**Error Responses:**

*Invalid OTP (400):*
```json
{
  "success": false,
  "message": "Incorrect OTP. Please check and try again."
}
```

*Expired OTP (400):*
```json
{
  "success": false,
  "message": "OTP has expired. Please request a new OTP."
}
```

---

### 5. Submit Quiz

Submit quiz answers and get score.

```http
POST /api/trivia/submit
Content-Type: application/json
```

**Request Body:**
```json
{
  "phoneNumber": "9876543210",
  "answers": [
    { "questionId": "q1", "selectedAnswer": "1953" },
    { "questionId": "q2", "selectedAnswer": "HH SWAMI CHINMAYANANDA SARASWATI" },
    { "questionId": "q3", "selectedAnswer": "CHINMAYA AMRIT MAHOTSAV" },
    { "questionId": "q4", "selectedAnswer": "YES" },
    { "questionId": "q5", "selectedAnswer": "YES" }
  ]
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Quiz submitted successfully!",
  "data": {
    "attemptId": "TRIV-20260130-00001",
    "name": "John Doe",
    "score": 3,
    "totalQuestions": 3,
    "answers": [
      {
        "question": "When was Chinmaya Mission founded?",
        "yourAnswer": "1953",
        "correctAnswer": "1953",
        "isCorrect": true
      },
      {
        "question": "Who founded Chinmaya Mission?",
        "yourAnswer": "HH SWAMI CHINMAYANANDA SARASWATI",
        "correctAnswer": "HH SWAMI CHINMAYANANDA SARASWATI",
        "isCorrect": true
      },
      {
        "question": "Which mahotsav is Chinmaya Mission celebrating?",
        "yourAnswer": "CHINMAYA AMRIT MAHOTSAV",
        "correctAnswer": "CHINMAYA AMRIT MAHOTSAV",
        "isCorrect": true
      },
      {
        "question": "Does Vedanta excite you?",
        "yourAnswer": "YES",
        "correctAnswer": "N/A",
        "isCorrect": null
      },
      {
        "question": "Do you want a free Gita session?",
        "yourAnswer": "YES",
        "correctAnswer": "N/A",
        "isCorrect": null
      }
    ]
  }
}
```

**Error Responses:**

*Not Verified (403):*
```json
{
  "success": false,
  "message": "Please verify your phone number before submitting the quiz."
}
```

*Already Submitted (400):*
```json
{
  "success": false,
  "message": "You have already submitted the quiz.",
  "data": {
    "attemptId": "TRIV-20260130-00001",
    "score": 3,
    "totalQuestions": 3
  }
}
```

---

### 6. Check Status (Optional)

Check user's current status by phone number.

```http
GET /api/trivia/status/:phoneNumber
```

**Example:**
```http
GET /api/trivia/status/9876543210
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "attemptId": "TRIV-20260130-00001",
    "name": "John Doe",
    "isVerified": true,
    "hasAttempted": false,
    "canAttemptQuiz": true,
    "score": null,
    "totalQuestions": 3
  }
}
```

---

## Step-by-Step Integration

### Step 1: Registration Screen

```javascript
// Collect name and phone, then call initiate API
const handleRegister = async (name, phoneNumber) => {
  try {
    const response = await fetch('/api/trivia/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phoneNumber })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Check if already verified (can skip OTP)
      if (data.data.isVerified && data.data.canAttemptQuiz) {
        navigateToQuiz();
      } else {
        // Start 60-second countdown
        startCooldownTimer(60);
        navigateToOTPScreen();
      }
    } else {
      // Handle error - show message to user
      showError(data.message);
      
      // If already completed, show their score
      if (data.data?.score !== undefined) {
        showPreviousResult(data.data);
      }
    }
  } catch (error) {
    showError('Network error. Please try again.');
  }
};
```

### Step 2: OTP Verification Screen

```javascript
// State for cooldown timer
const [cooldownSeconds, setCooldownSeconds] = useState(60);
const [canResend, setCanResend] = useState(false);

// Countdown timer effect
useEffect(() => {
  if (cooldownSeconds > 0) {
    const timer = setTimeout(() => {
      setCooldownSeconds(prev => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  } else {
    setCanResend(true);
  }
}, [cooldownSeconds]);

// Verify OTP
const handleVerifyOTP = async (otp) => {
  try {
    const response = await fetch('/api/trivia/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber, otp })
    });
    
    const data = await response.json();
    
    if (data.success) {
      navigateToQuiz();
    } else {
      showError(data.message);
    }
  } catch (error) {
    showError('Network error. Please try again.');
  }
};

// Resend OTP
const handleResendOTP = async () => {
  if (!canResend) return;
  
  try {
    const response = await fetch('/api/trivia/resend-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber })
    });
    
    const data = await response.json();
    
    if (data.success) {
      setCooldownSeconds(60);
      setCanResend(false);
      showSuccess('OTP resent successfully!');
    } else {
      // If still in cooldown, update timer
      if (data.remainingSeconds) {
        setCooldownSeconds(data.remainingSeconds);
        setCanResend(false);
      }
      showError(data.message);
    }
  } catch (error) {
    showError('Network error. Please try again.');
  }
};
```

### Step 3: Quiz Screen

```javascript
// Fetch questions on mount
useEffect(() => {
  fetchQuestions();
}, []);

const fetchQuestions = async () => {
  const response = await fetch('/api/trivia/questions');
  const data = await response.json();
  
  if (data.success) {
    setQuestions(data.data.questions);
  }
};

// Track selected answers
const [answers, setAnswers] = useState({});

const handleSelectAnswer = (questionId, selectedAnswer) => {
  setAnswers(prev => ({
    ...prev,
    [questionId]: selectedAnswer
  }));
};

// Submit quiz
const handleSubmitQuiz = async () => {
  // Format answers for API
  const formattedAnswers = Object.entries(answers).map(([questionId, selectedAnswer]) => ({
    questionId,
    selectedAnswer
  }));
  
  try {
    const response = await fetch('/api/trivia/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumber,
        answers: formattedAnswers
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      navigateToResults(data.data);
    } else {
      showError(data.message);
    }
  } catch (error) {
    showError('Network error. Please try again.');
  }
};
```

### Step 4: Results Screen

```javascript
// Display results from submit response
const ResultsScreen = ({ results }) => {
  return (
    <div>
      <h1>🎉 Quiz Completed!</h1>
      <h2>Your Score: {results.score}/{results.totalQuestions}</h2>
      
      <div className="answers-review">
        {results.answers.map((answer, index) => (
          <div 
            key={index} 
            className={`answer-card ${answer.isCorrect === true ? 'correct' : answer.isCorrect === false ? 'incorrect' : 'opinion'}`}
          >
            <p className="question">{answer.question}</p>
            <p>Your Answer: {answer.yourAnswer}</p>
            {answer.correctAnswer !== 'N/A' && (
              <p>Correct Answer: {answer.correctAnswer}</p>
            )}
            {answer.isCorrect === true && <span>✅ Correct</span>}
            {answer.isCorrect === false && <span>❌ Incorrect</span>}
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## Error Handling

### HTTP Status Codes

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Bad Request (validation error, already completed, etc.) |
| 403 | Forbidden (not verified) |
| 404 | Not Found (no registration found) |
| 429 | Too Many Requests (rate limited) |
| 500 | Server Error |

### Common Error Scenarios

```javascript
const handleApiError = (response, data) => {
  switch (response.status) {
    case 400:
      // Validation or business logic error
      if (data.errors) {
        // Multiple validation errors
        data.errors.forEach(err => showError(err));
      } else {
        showError(data.message);
      }
      
      // Check if user already completed
      if (data.data?.score !== undefined) {
        redirectToResults(data.data);
      }
      break;
      
    case 403:
      // Not verified - redirect to OTP screen
      showError('Please verify your phone number first.');
      navigateToOTPScreen();
      break;
      
    case 404:
      // Not registered - redirect to registration
      showError('Please register first.');
      navigateToRegistration();
      break;
      
    case 429:
      // Rate limited
      showError(data.message);
      if (data.remainingSeconds) {
        startCooldownTimer(data.remainingSeconds);
      }
      break;
      
    case 500:
      showError('Something went wrong. Please try again later.');
      break;
      
    default:
      showError('An unexpected error occurred.');
  }
};
```

---

## React Example Implementation

### Complete Trivia Component

```jsx
import React, { useState, useEffect } from 'react';

const API_BASE = '/api/trivia';

// Screens
const SCREENS = {
  REGISTER: 'register',
  OTP: 'otp',
  QUIZ: 'quiz',
  RESULTS: 'results'
};

const TriviaQuiz = () => {
  // Screen state
  const [currentScreen, setCurrentScreen] = useState(SCREENS.REGISTER);
  
  // User data
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [attemptId, setAttemptId] = useState('');
  
  // OTP state
  const [otp, setOtp] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  
  // Quiz state
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [currentQuestion, setCurrentQuestion] = useState(0);
  
  // Results state
  const [results, setResults] = useState(null);
  
  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Cooldown timer
  useEffect(() => {
    if (cooldownSeconds > 0) {
      const timer = setTimeout(() => setCooldownSeconds(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownSeconds]);

  // Fetch questions when entering quiz screen
  useEffect(() => {
    if (currentScreen === SCREENS.QUIZ && questions.length === 0) {
      fetchQuestions();
    }
  }, [currentScreen]);

  const fetchQuestions = async () => {
    try {
      const response = await fetch(`${API_BASE}/questions`);
      const data = await response.json();
      if (data.success) {
        setQuestions(data.data.questions);
      }
    } catch (err) {
      setError('Failed to load questions.');
    }
  };

  // STEP 1: Register and send OTP
  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phoneNumber })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setAttemptId(data.data.attemptId);
        
        if (data.data.isVerified && data.data.canAttemptQuiz) {
          setCurrentScreen(SCREENS.QUIZ);
        } else {
          setCooldownSeconds(data.data.cooldownSeconds || 60);
          setCurrentScreen(SCREENS.OTP);
        }
      } else {
        setError(data.message);
        if (data.data?.score !== undefined) {
          setResults(data.data);
          setCurrentScreen(SCREENS.RESULTS);
        }
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // STEP 2: Verify OTP
  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, otp })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setCurrentScreen(SCREENS.QUIZ);
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResendOTP = async () => {
    if (cooldownSeconds > 0) return;
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setCooldownSeconds(60);
      } else {
        if (data.remainingSeconds) {
          setCooldownSeconds(data.remainingSeconds);
        }
        setError(data.message);
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // STEP 3: Submit Quiz
  const handleSubmitQuiz = async () => {
    setError('');
    setLoading(true);

    const formattedAnswers = Object.entries(answers).map(([questionId, selectedAnswer]) => ({
      questionId,
      selectedAnswer
    }));

    try {
      const response = await fetch(`${API_BASE}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, answers: formattedAnswers })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setResults(data.data);
        setCurrentScreen(SCREENS.RESULTS);
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Select answer
  const handleSelectAnswer = (questionId, answer) => {
    setAnswers(prev => ({ ...prev, [questionId]: answer }));
  };

  // Render screens
  const renderScreen = () => {
    switch (currentScreen) {
      case SCREENS.REGISTER:
        return (
          <form onSubmit={handleRegister} className="trivia-form">
            <h2>Chinmaya Amrit Mahotsav Trivia</h2>
            <p>Enter your details to start the quiz</p>
            
            <input
              type="text"
              placeholder="Your Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
            />
            
            <input
              type="tel"
              placeholder="Phone Number (10 digits)"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
              required
              pattern="[6-9][0-9]{9}"
            />
            
            <button type="submit" disabled={loading}>
              {loading ? 'Sending OTP...' : 'Get OTP'}
            </button>
          </form>
        );

      case SCREENS.OTP:
        return (
          <form onSubmit={handleVerifyOTP} className="trivia-form">
            <h2>Verify Phone Number</h2>
            <p>Enter the OTP sent to {phoneNumber.slice(0, 4)}****{phoneNumber.slice(8)}</p>
            
            <input
              type="text"
              placeholder="Enter 6-digit OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              maxLength={6}
            />
            
            <button type="submit" disabled={loading || otp.length < 4}>
              {loading ? 'Verifying...' : 'Verify OTP'}
            </button>
            
            <button 
              type="button" 
              onClick={handleResendOTP}
              disabled={cooldownSeconds > 0 || loading}
              className="resend-btn"
            >
              {cooldownSeconds > 0 
                ? `Resend OTP in ${cooldownSeconds}s` 
                : 'Resend OTP'}
            </button>
          </form>
        );

      case SCREENS.QUIZ:
        const question = questions[currentQuestion];
        if (!question) return <p>Loading questions...</p>;
        
        return (
          <div className="trivia-quiz">
            <div className="progress">
              Question {currentQuestion + 1} of {questions.length}
            </div>
            
            <h3>{question.question}</h3>
            
            <div className="options">
              {question.options.map((option, idx) => (
                <button
                  key={idx}
                  className={`option ${answers[question.id] === option ? 'selected' : ''}`}
                  onClick={() => handleSelectAnswer(question.id, option)}
                >
                  {option}
                </button>
              ))}
            </div>
            
            <div className="navigation">
              {currentQuestion > 0 && (
                <button onClick={() => setCurrentQuestion(prev => prev - 1)}>
                  Previous
                </button>
              )}
              
              {currentQuestion < questions.length - 1 ? (
                <button 
                  onClick={() => setCurrentQuestion(prev => prev + 1)}
                  disabled={!answers[question.id]}
                >
                  Next
                </button>
              ) : (
                <button 
                  onClick={handleSubmitQuiz}
                  disabled={loading || Object.keys(answers).length < questions.length}
                >
                  {loading ? 'Submitting...' : 'Submit Quiz'}
                </button>
              )}
            </div>
          </div>
        );

      case SCREENS.RESULTS:
        return (
          <div className="trivia-results">
            <h2>🎉 Quiz Completed!</h2>
            <div className="score">
              Your Score: {results.score}/{results.totalQuestions}
            </div>
            
            <div className="answers-review">
              {results.answers?.map((answer, idx) => (
                <div 
                  key={idx}
                  className={`answer-card ${
                    answer.isCorrect === true ? 'correct' : 
                    answer.isCorrect === false ? 'incorrect' : 'opinion'
                  }`}
                >
                  <p className="question">{answer.question}</p>
                  <p><strong>Your Answer:</strong> {answer.yourAnswer}</p>
                  {answer.correctAnswer !== 'N/A' && (
                    <p><strong>Correct Answer:</strong> {answer.correctAnswer}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="trivia-container">
      {error && <div className="error-message">{error}</div>}
      {renderScreen()}
    </div>
  );
};

export default TriviaQuiz;
```

---

## State Management

### Recommended State Structure

```javascript
const triviaState = {
  // User info
  user: {
    name: '',
    phoneNumber: '',
    attemptId: '',
    isVerified: false
  },
  
  // OTP state
  otp: {
    value: '',
    cooldownSeconds: 0,
    canResend: true
  },
  
  // Quiz state
  quiz: {
    questions: [],
    answers: {},
    currentQuestionIndex: 0,
    isSubmitting: false
  },
  
  // Results
  results: {
    score: null,
    totalQuestions: null,
    answers: []
  },
  
  // UI state
  ui: {
    currentScreen: 'register', // 'register' | 'otp' | 'quiz' | 'results'
    loading: false,
    error: null
  }
};
```

### Using with Redux/Zustand

```javascript
// Zustand example
import { create } from 'zustand';

const useTriviaStore = create((set, get) => ({
  // State
  ...triviaState,
  
  // Actions
  setName: (name) => set(state => ({ user: { ...state.user, name } })),
  setPhone: (phone) => set(state => ({ user: { ...state.user, phoneNumber: phone } })),
  setOTP: (otp) => set(state => ({ otp: { ...state.otp, value: otp } })),
  selectAnswer: (questionId, answer) => set(state => ({
    quiz: { ...state.quiz, answers: { ...state.quiz.answers, [questionId]: answer } }
  })),
  setScreen: (screen) => set(state => ({ ui: { ...state.ui, currentScreen: screen } })),
  setLoading: (loading) => set(state => ({ ui: { ...state.ui, loading } })),
  setError: (error) => set(state => ({ ui: { ...state.ui, error } })),
  
  // Reset
  reset: () => set(triviaState)
}));
```

---

## UI/UX Recommendations

### 1. Phone Number Input
- Auto-format as user types: `98765 43210`
- Show validation error immediately for invalid numbers
- Prefix with +91 flag/icon for Indian numbers

### 2. OTP Input
- Use 6 separate input boxes for better UX
- Auto-focus next box on input
- Auto-submit when all 6 digits entered
- Show countdown timer prominently

### 3. Quiz Screen
- Show progress bar/indicator
- Highlight selected option clearly
- Allow changing answers before submit
- Show confirmation modal before final submit

### 4. Results Screen
- Celebrate high scores with animations/confetti
- Color-code correct (green) vs incorrect (red) answers
- Show social share buttons
- Provide option to learn more about Chinmaya Mission

### 5. Error Handling
- Toast notifications for non-blocking errors
- Clear error messages with actions
- Retry buttons for network errors

### 6. Loading States
- Skeleton loaders for questions
- Spinner/loading text on buttons
- Disable interactions during API calls

---

## Testing Checklist

- [ ] Register with valid name and phone
- [ ] Register with invalid phone (should show error)
- [ ] Register with same phone twice (should show "already completed" or allow continue)
- [ ] Verify with correct OTP
- [ ] Verify with wrong OTP (should show error)
- [ ] Resend OTP before 60 seconds (should show cooldown)
- [ ] Resend OTP after 60 seconds (should work)
- [ ] Submit quiz with all answers
- [ ] Submit quiz without verification (should show error)
- [ ] Try to submit quiz twice (should show "already submitted")
- [ ] Check CSV export with admin endpoint

---

## Support

For any integration issues, check the server logs or contact the backend team.
