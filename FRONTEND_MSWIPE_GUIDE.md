# Mswipe Payment Gateway - Frontend Integration Guide

## 🏗️ Backend Architecture Overview

This document explains the backend architecture for Mswipe payment integration so you can implement the frontend correctly.

### Payment Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        COMPLETE PAYMENT FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  FRONTEND                        BACKEND                         MSWIPE        │
│  ────────                        ───────                         ──────        │
│                                                                                 │
│  1. User fills donation form                                                    │
│           │                                                                     │
│           ▼                                                                     │
│  2. POST /api/mswipe/initiate ────────► Creates PENDING donation               │
│     (donation details)                          │                               │
│                                                 ▼                               │
│                                        Calls CreatePBLAuthToken ────► Token    │
│                                                 │                               │
│                                                 ▼                               │
│                                        Calls MswipePayment ─────────► smslink  │
│                                                 │                               │
│                                                 ▼                               │
│  3. Receives { paymentUrl, donationRef } ◄─────┘                               │
│           │                                                                     │
│           ▼                                                                     │
│  4. window.location.href = paymentUrl ──────────────────────────► Payment Page │
│                                                                         │       │
│                                                                         ▼       │
│                                                              User pays here     │
│                                                                         │       │
│                                                                         ▼       │
│                                        BackPosting webhook ◄────────────┘       │
│                                        POST /api/mswipe/callback                │
│                                                 │                               │
│                                                 ▼                               │
│                                        Updates donation to SUCCESS/FAILED       │
│                                        Sends confirmation email (if SUCCESS)    │
│                                                 │                               │
│                                                 ▼                               │
│  5. User redirected to ◄───────────── redirect_url?status=success&ref=xxx      │
│     /payment-result page                                                        │
│           │                                                                     │
│           ▼                                                                     │
│  6. GET /api/mswipe/status/:ref ─────► Returns final status                    │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Backend Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/mswipe/initiate` | Create donation & get payment URL |
| `POST` | `/api/mswipe/callback` | Webhook (Mswipe → Backend, not for frontend) |
| `GET` | `/api/mswipe/status/:donationRef` | Check donation payment status |
| `POST` | `/api/mswipe/verify/:donationRef` | Force status check with Mswipe API |
| `GET` | `/api/mswipe/info` | Debug: Check service configuration |

---

## 🚀 Quick Start Implementation

### Step 1: Create Donation Form & Initiate Payment

```javascript
// API Base URL (update for production)
const API_BASE_URL = 'https://api.chinmayamissionvasai.com'; // or http://localhost:5002 for dev

/**
 * Initiate Mswipe payment
 * @param {Object} donationData - Form data from user
 * @returns {Promise<{success: boolean, paymentUrl?: string, donationRef?: string, error?: string}>}
 */
const initiateDonation = async (donationData) => {
  try {
    const response = await fetch(`${API_BASE_URL}/api/mswipe/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fullName: donationData.fullName,
        email: donationData.email,
        phoneNumber: donationData.phoneNumber,  // 10 digits only
        amount: Number(donationData.amount),     // Must be a number
        state: donationData.state,
        city: donationData.city,
        pinCode: donationData.pinCode,          // 6 digits
        address: donationData.address,
        seek80G: donationData.seek80G,          // 'yes' or 'no'
        reasonForDonation: donationData.reasonForDonation,
        purpose: donationData.purpose || '',     // optional
        panCardNumber: donationData.panCardNumber || '' // optional
      })
    });

    const result = await response.json();

    if (response.ok && result.success) {
      // ✅ Store reference before redirecting (for result page)
      localStorage.setItem('pendingDonationRef', result.donationRef);
      localStorage.setItem('pendingDonationAmount', donationData.amount);
      
      // ✅ Redirect user to Mswipe payment page
      window.location.href = result.paymentUrl;
      
      return { success: true, donationRef: result.donationRef };
    } else {
      // ❌ Handle errors
      return { 
        success: false, 
        error: result.errors?.join(', ') || result.error || 'Payment initiation failed'
      };
    }
  } catch (error) {
    console.error('Payment initiation error:', error);
    return { success: false, error: 'Network error. Please check your connection.' };
  }
};
```

### Step 2: Create Payment Result Page

After payment, Mswipe redirects user to: `FRONTEND_PAYMENT_RESULT_URL?status=success&ref=CMVxxx&amount=100`

Create a page at `/payment-result` (or your configured URL):

```jsx
// pages/PaymentResult.jsx (React example)
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

const API_BASE_URL = 'https://api.chinmayamissionvasai.com';

const PaymentResult = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  // Get params from URL (set by Mswipe callback redirect)
  const status = searchParams.get('status');      // 'success' or 'failed'
  const ref = searchParams.get('ref');            // donation reference
  const amount = searchParams.get('amount');      // amount paid
  
  const [verifiedStatus, setVerifiedStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [donationDetails, setDonationDetails] = useState(null);

  useEffect(() => {
    // ✅ IMPORTANT: Always verify status with backend
    // Don't trust URL params alone!
    if (ref) {
      verifyPaymentStatus(ref);
    } else {
      // Try to get ref from localStorage (if URL param missing)
      const storedRef = localStorage.getItem('pendingDonationRef');
      if (storedRef) {
        verifyPaymentStatus(storedRef);
      } else {
        setLoading(false);
      }
    }
  }, [ref]);

  const verifyPaymentStatus = async (donationRef) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/mswipe/status/${donationRef}`);
      const data = await response.json();
      
      if (response.ok) {
        setVerifiedStatus(data.status); // 'SUCCESS', 'FAILED', or 'PENDING'
        setDonationDetails(data);
        
        // Clear stored data on success
        if (data.status === 'SUCCESS') {
          localStorage.removeItem('pendingDonationRef');
          localStorage.removeItem('pendingDonationAmount');
        }
      } else {
        setVerifiedStatus('ERROR');
      }
    } catch (error) {
      console.error('Status verification failed:', error);
      setVerifiedStatus('ERROR');
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="payment-result loading">
        <div className="spinner"></div>
        <p>Verifying payment status...</p>
      </div>
    );
  }

  // Success state
  if (verifiedStatus === 'SUCCESS') {
    return (
      <div className="payment-result success">
        <div className="icon">✅</div>
        <h1>Payment Successful!</h1>
        <p>Thank you for your generous donation to Chinmaya Mission Vasai.</p>
        
        <div className="details-card">
          <div className="detail-row">
            <span>Donation Reference:</span>
            <strong>{donationDetails?.donationRef}</strong>
          </div>
          <div className="detail-row">
            <span>Amount:</span>
            <strong>₹{donationDetails?.amount}</strong>
          </div>
          <div className="detail-row">
            <span>Transaction ID:</span>
            <strong>{donationDetails?.transactionRef}</strong>
          </div>
          <div className="detail-row">
            <span>Date:</span>
            <strong>{new Date(donationDetails?.updatedAt).toLocaleDateString('en-IN')}</strong>
          </div>
        </div>
        
        <p className="email-note">
          📧 A confirmation email has been sent to your registered email address.
        </p>
        
        <button onClick={() => navigate('/')}>
          Return to Home
        </button>
      </div>
    );
  }

  // Failed state
  if (verifiedStatus === 'FAILED') {
    return (
      <div className="payment-result failed">
        <div className="icon">❌</div>
        <h1>Payment Failed</h1>
        <p>Unfortunately, your payment could not be processed.</p>
        
        {donationDetails?.donationRef && (
          <p className="reference">Reference: {donationDetails.donationRef}</p>
        )}
        
        <div className="actions">
          <button onClick={() => navigate('/donate')} className="primary">
            Try Again
          </button>
          <button onClick={() => navigate('/contact')} className="secondary">
            Contact Support
          </button>
        </div>
      </div>
    );
  }

  // Pending state (payment not yet confirmed)
  if (verifiedStatus === 'PENDING') {
    return (
      <div className="payment-result pending">
        <div className="icon">⏳</div>
        <h1>Payment Processing</h1>
        <p>Your payment is being processed. Please wait...</p>
        <p className="reference">Reference: {donationDetails?.donationRef}</p>
        
        <button onClick={() => verifyPaymentStatus(donationDetails?.donationRef)}>
          Check Status Again
        </button>
      </div>
    );
  }

  // Error/Unknown state
  return (
    <div className="payment-result error">
      <div className="icon">⚠️</div>
      <h1>Something Went Wrong</h1>
      <p>We couldn't verify your payment status.</p>
      <p>If you completed the payment, please contact support with your reference number.</p>
      
      <div className="actions">
        <button onClick={() => navigate('/donate')}>
          Make a New Donation
        </button>
        <button onClick={() => navigate('/contact')}>
          Contact Support
        </button>
      </div>
    </div>
  );
};

export default PaymentResult;
```

---

## 📋 API Reference

### 1. POST /api/mswipe/initiate

**Request Body:**
```typescript
interface DonationRequest {
  fullName: string;           // Required, min 2 characters
  email: string;              // Required, valid email format
  phoneNumber: string;        // Required, exactly 10 digits
  amount: number;             // Required, positive number (in Rupees)
  state: string;              // Required, Indian state name
  city: string;               // Required
  pinCode: string;            // Required, exactly 6 digits
  address: string;            // Required
  seek80G: 'yes' | 'no';      // Required
  reasonForDonation:          // Required, one of:
    | 'Gurudakshina'
    | 'General Donation'
    | 'Event Sponsorship'
    | 'Building Fund'
    | 'Educational Support'
    | 'Community Service'
    | 'Special Occasion'
    | 'Other';
  purpose?: string;           // Optional, free text
  panCardNumber?: string;     // Optional, 10 characters (for 80G)
}
```

**Success Response (200):**
```typescript
{
  success: true,
  paymentUrl: "https://dcuat.mswipetech.co.in/pay-by-link/payment-options?TransID=xxx",
  donationRef: "CMV17688247321751938",   // Your reference for tracking
  orderId: "CMV17688247321759427"        // Mswipe order ID
}
```

**Error Response (400/500):**
```typescript
{
  errors?: string[];    // Array of validation errors
  error?: string;       // Single error message
  donationRef?: string; // May be present for support queries
}
```

**Rate Limit:** 5 requests per 15 minutes per IP

---

### 2. GET /api/mswipe/status/:donationRef

**URL Parameter:** `donationRef` - The reference returned from initiate

**Success Response (200):**
```typescript
{
  donationRef: "CMV17688247321751938",
  status: "SUCCESS" | "PENDING" | "FAILED",
  amount: 100,
  transactionRef: "000007963164",     // Bank RRN (for successful payments)
  ipgId: "IPG000000031322",           // Mswipe's transaction ID
  createdAt: "2026-01-19T12:12:12.179Z",
  updatedAt: "2026-01-19T12:15:30.862Z"
}
```

**Error Response (404):**
```typescript
{
  error: "Donation not found"
}
```

**Rate Limit:** 30 requests per 15 minutes per IP

---

### 3. POST /api/mswipe/verify/:donationRef

Use this to force a status check with Mswipe API (if callback was missed):

**Success Response (200):**
```typescript
{
  donationRef: "CMV17688247321751938",
  status: "SUCCESS",
  mswipeStatus: {
    ipgId: "IPG000000031322",
    status: "SUCCESS",
    statusCode: 1,
    paymentId: "000007963164",
    // ... more Mswipe details
  },
  amount: 100,
  transactionRef: "000007963164",
  updatedAt: "2026-01-19T12:15:30.862Z"
}
```

---

## 🎨 Complete React Component Example

```jsx
import React, { useState } from 'react';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5002';

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh'
];

const DONATION_REASONS = [
  'General Donation',
  'Gurudakshina',
  'Event Sponsorship',
  'Building Fund',
  'Educational Support',
  'Community Service',
  'Special Occasion',
  'Other'
];

const DonationForm = () => {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phoneNumber: '',
    amount: '',
    state: 'Maharashtra',
    city: '',
    pinCode: '',
    address: '',
    seek80G: 'no',
    reasonForDonation: 'General Donation',
    purpose: '',
    panCardNumber: ''
  });
  
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setErrors([]); // Clear errors on change
  };

  const validateForm = () => {
    const newErrors = [];
    
    if (!formData.fullName.trim() || formData.fullName.length < 2) {
      newErrors.push('Full name must be at least 2 characters');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.push('Please enter a valid email address');
    }
    if (!/^[0-9]{10}$/.test(formData.phoneNumber)) {
      newErrors.push('Phone number must be exactly 10 digits');
    }
    if (!formData.amount || Number(formData.amount) <= 0) {
      newErrors.push('Please enter a valid donation amount');
    }
    if (!/^[0-9]{6}$/.test(formData.pinCode)) {
      newErrors.push('Pin code must be exactly 6 digits');
    }
    if (!formData.address.trim()) {
      newErrors.push('Address is required');
    }
    if (formData.seek80G === 'yes' && !formData.panCardNumber) {
      newErrors.push('PAN card number is required for 80G certificate');
    }
    if (formData.panCardNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(formData.panCardNumber.toUpperCase())) {
      newErrors.push('Please enter a valid PAN card number');
    }
    
    return newErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Client-side validation
    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    
    setLoading(true);
    setErrors([]);

    try {
      const response = await fetch(`${API_BASE_URL}/api/mswipe/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          amount: Number(formData.amount),
          panCardNumber: formData.panCardNumber.toUpperCase() || undefined
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Store for result page
        localStorage.setItem('pendingDonationRef', result.donationRef);
        localStorage.setItem('pendingDonationAmount', formData.amount);
        localStorage.setItem('pendingDonationName', formData.fullName);
        
        // Redirect to Mswipe
        window.location.href = result.paymentUrl;
      } else {
        setErrors(result.errors || [result.error || 'Payment initiation failed']);
      }
    } catch (error) {
      console.error('Error:', error);
      setErrors(['Network error. Please check your connection and try again.']);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="donation-form">
      <h2>Make a Donation</h2>
      
      {errors.length > 0 && (
        <div className="error-box">
          {errors.map((err, i) => <p key={i}>⚠️ {err}</p>)}
        </div>
      )}

      <div className="form-group">
        <label>Full Name *</label>
        <input
          type="text"
          name="fullName"
          value={formData.fullName}
          onChange={handleChange}
          placeholder="Enter your full name"
          required
        />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Email *</label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            placeholder="your@email.com"
            required
          />
        </div>

        <div className="form-group">
          <label>Phone Number *</label>
          <input
            type="tel"
            name="phoneNumber"
            value={formData.phoneNumber}
            onChange={handleChange}
            placeholder="9876543210"
            maxLength={10}
            required
          />
        </div>
      </div>

      <div className="form-group">
        <label>Donation Amount (₹) *</label>
        <input
          type="number"
          name="amount"
          value={formData.amount}
          onChange={handleChange}
          placeholder="Enter amount"
          min="1"
          required
        />
      </div>

      <div className="form-group">
        <label>Reason for Donation *</label>
        <select
          name="reasonForDonation"
          value={formData.reasonForDonation}
          onChange={handleChange}
          required
        >
          {DONATION_REASONS.map(reason => (
            <option key={reason} value={reason}>{reason}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Purpose (Optional)</label>
        <textarea
          name="purpose"
          value={formData.purpose}
          onChange={handleChange}
          placeholder="Describe the purpose of your donation"
          rows={3}
        />
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>State *</label>
          <select
            name="state"
            value={formData.state}
            onChange={handleChange}
            required
          >
            {INDIAN_STATES.map(state => (
              <option key={state} value={state}>{state}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>City *</label>
          <input
            type="text"
            name="city"
            value={formData.city}
            onChange={handleChange}
            placeholder="City"
            required
          />
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Pin Code *</label>
          <input
            type="text"
            name="pinCode"
            value={formData.pinCode}
            onChange={handleChange}
            placeholder="400001"
            maxLength={6}
            required
          />
        </div>

        <div className="form-group">
          <label>Address *</label>
          <input
            type="text"
            name="address"
            value={formData.address}
            onChange={handleChange}
            placeholder="Full address"
            required
          />
        </div>
      </div>

      <div className="form-group">
        <label>Do you need 80G Certificate? *</label>
        <div className="radio-group">
          <label>
            <input
              type="radio"
              name="seek80G"
              value="yes"
              checked={formData.seek80G === 'yes'}
              onChange={handleChange}
            />
            Yes
          </label>
          <label>
            <input
              type="radio"
              name="seek80G"
              value="no"
              checked={formData.seek80G === 'no'}
              onChange={handleChange}
            />
            No
          </label>
        </div>
      </div>

      {formData.seek80G === 'yes' && (
        <div className="form-group">
          <label>PAN Card Number *</label>
          <input
            type="text"
            name="panCardNumber"
            value={formData.panCardNumber}
            onChange={handleChange}
            placeholder="ABCDE1234F"
            maxLength={10}
            style={{ textTransform: 'uppercase' }}
            required={formData.seek80G === 'yes'}
          />
        </div>
      )}

      <button 
        type="submit" 
        disabled={loading}
        className="submit-btn"
      >
        {loading ? (
          <>
            <span className="spinner"></span>
            Processing...
          </>
        ) : (
          `Donate ₹${formData.amount || '0'}`
        )}
      </button>

      <p className="security-note">
        🔒 Your payment is secured by Mswipe Payment Gateway
      </p>
    </form>
  );
};

export default DonationForm;
```

---

## ⚠️ Important Security Notes

### ✅ DO:
- Always redirect users to `paymentUrl` from backend response
- Always verify payment status with `/api/mswipe/status/:ref` after redirect
- Store `donationRef` in localStorage before redirecting
- Show loading states during API calls
- Handle all error cases gracefully
- Validate form data on frontend before submission

### ❌ DON'T:
- Never call Mswipe API directly from frontend
- Never trust URL parameters as final payment status
- Never store or expose any API credentials in frontend code
- Never modify or construct payment URLs manually
- Never assume payment succeeded based on redirect alone

---

## 🧪 Testing

### Test in UAT Environment

The backend is configured for Mswipe UAT (testing) environment. Use these test values:

```javascript
const testDonation = {
  fullName: "Test Donor",
  email: "test@example.com",
  phoneNumber: "9876543210",
  amount: 1,  // Use small amount for testing
  state: "Maharashtra",
  city: "Vasai",
  pinCode: "401201",
  address: "Test Address, Vasai",
  seek80G: "no",
  reasonForDonation: "General Donation"
};
```

### Test Flow:
1. Fill form with test data
2. Submit → You'll get a `paymentUrl`
3. Complete payment on Mswipe UAT page
4. Get redirected to result page
5. Verify status shows SUCCESS

---

## 🔧 Environment Configuration

### Frontend Environment Variables

```env
# .env or .env.local
REACT_APP_API_URL=http://localhost:5002
# For production:
# REACT_APP_API_URL=https://api.chinmayamissionvasai.com
```

### Required Routes

Set up these routes in your frontend:

| Route | Purpose |
|-------|---------|
| `/donate` | Donation form page |
| `/payment-result` | Payment result page (redirect URL) |

---

## 📞 Support

- **Backend Issues:** Check server logs, verify API responses
- **Payment Issues:** Contact Mswipe support with IPG_ID
- **Integration Questions:** Refer to this guide

---

**Last Updated:** January 19, 2026  
**Backend Version:** 2.0 (Mswipe PBL API)  
**Mswipe Environment:** UAT (for testing) → Switch to Production when ready
