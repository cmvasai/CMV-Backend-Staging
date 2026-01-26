# Mswipe Payment Gateway Integration - Backend Documentation

## Overview

This backend now supports **Mswipe IPG (Payment Gateway)** for processing donations. The manual QR/UPI-based donation flow has been deprecated and replaced with automated payment gateway integration.

---

## Architecture Changes

### Database Schema Updates

**Donation Model** (`src/models/Donation.js`) has been extended with:

```javascript
{
  // LEGACY: Optional for backward compatibility
  transactionId: { type: String, unique: true, sparse: true },
  
  // NEW: Payment Gateway Fields
  paymentGateway: { type: String, enum: ['manual', 'mswipe'], default: 'mswipe' },
  paymentStatus: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED'], default: 'PENDING' },
  
  // Mswipe-specific fields
  mswipeOrderId: { type: String, sparse: true, index: true },
  mswipeTransactionRef: { type: String },
  mswipePaymentResponse: { type: Schema.Types.Mixed }
}
```

**Key Changes:**
- `transactionId` is now **optional** (only for legacy manual donations)
- `paymentStatus` replaces reliance on legacy `status` field
- Mswipe transaction details stored separately

---

## API Endpoints

### 1. Initiate Mswipe Payment

**Endpoint:** `POST /api/mswipe/initiate`  
**Rate Limit:** 5 requests per 15 minutes per IP  
**Authentication:** None (Public)

**Request Body:**
```json
{
  "fullName": "John Doe",
  "email": "john@example.com",
  "phoneNumber": "9876543210",
  "amount": 1000,
  "state": "Maharashtra",
  "city": "Mumbai",
  "pinCode": "400001",
  "address": "123 Main Street",
  "seek80G": "yes",
  "reasonForDonation": "General Donation",
  "purpose": "Support education programs",
  "panCardNumber": "ABCDE1234F"
}
```

**Response (Success):**
```json
{
  "success": true,
  "paymentUrl": "https://mswipe.payment.url/checkout/MSWP1705420800001",
  "donationRef": "CMV1705420800001",
  "orderId": "MSWP1705420800001"
}
```

**Flow:**
1. Backend validates input
2. Creates donation with `paymentStatus: 'PENDING'`
3. Calls Mswipe IPG API to create payment order
4. Returns `paymentUrl` to frontend
5. Frontend redirects user to Mswipe checkout page

---

### 2. Mswipe Payment Callback

**Endpoint:** `POST /api/mswipe/callback`  
**Authentication:** None (Called by Mswipe servers)  
**Purpose:** Webhook to receive payment status from Mswipe

**Request Body:** (From Mswipe API - structure may vary)
```json
{
  "invoiceId": "MSWP1705420800001",
  "transactionId": "TXN123456789",
  "status": "success",
  "amount": "1000",
  "message": "Payment successful"
}
```

**Behavior:**
1. Verifies callback data using `mswipeService.verifyCallback()`
2. Finds donation by `mswipeOrderId`
3. **Security Check:** Only updates donations with `paymentStatus: 'PENDING'`
4. Updates status to `SUCCESS` or `FAILED`
5. Stores `mswipeTransactionRef`
6. Sends confirmation email (SUCCESS only)
7. Redirects to: `FRONTEND_PAYMENT_RESULT_URL?status={status}&ref={donationRef}`

**Security Features:**
- Prevents replay attacks (only updates PENDING donations)
- Validates amount matches original donation
- Logs all callback attempts

---

### 3. Get Donation Status

**Endpoint:** `GET /api/mswipe/status/:donationRef`  
**Authentication:** None (Public)

**Response:**
```json
{
  "donationRef": "CMV1705420800001",
  "status": "SUCCESS",
  "amount": 1000,
  "transactionRef": "TXN123456789",
  "createdAt": "2026-01-16T10:00:00.000Z",
  "updatedAt": "2026-01-16T10:05:23.000Z"
}
```

---

### 4. Legacy Manual Donation (DEPRECATED)

**Endpoint:** `POST /api/donations`  
**Status:** Kept for backward compatibility only

**Changes:**
- Now creates donations with `paymentGateway: 'manual'`
- Sets `paymentStatus: 'SUCCESS'` (assumes external payment)
- **Does NOT send confirmation email** (deferred to callback flow)
- Returns deprecation message

---

## Environment Variables

Add to `.env` file:

```bash
# === MSWIPE PAYMENT GATEWAY CONFIGURATION ===
# Based on official Mswipe PBL API Documentation
# https://docs.mswipe.com/#/Gettingstarted

# Environment: 'production' or 'uat' (default: uat)
MSWIPE_ENV="uat"

# Mswipe IPG API Credentials (provided by Mswipe during merchant onboarding)
MSWIPE_USER_ID="your_user_id"
MSWIPE_CLIENT_ID="your_client_id"
MSWIPE_PASSWORD="your_secret_password"
MSWIPE_CUST_CODE="your_cust_code"

# Fixed API Parameters (usually don't change)
MSWIPE_APPL_ID="api"
MSWIPE_CHANNEL_ID="pbl"
MSWIPE_VERSION="VER4.0.0"

# Redirect URL after payment completion (your frontend)
MSWIPE_REDIRECT_URL="https://chinmayamissionvasai.com/payment-result"

# Frontend result page URL for callback redirects
FRONTEND_PAYMENT_RESULT_URL="https://chinmayamissionvasai.com/donation/result"
```

**API URLs (automatically set based on MSWIPE_ENV):**
| Environment | Base URL |
|-------------|----------|
| UAT (Testing) | `https://dcuat.mswipetech.co.in` |
| Production | `https://pbl.mswipe.com` |

**Production Checklist:**
- [ ] Set `MSWIPE_ENV=production`
- [ ] Update credentials to production values
- [ ] Share BackPosting (callback) URL with Mswipe team: `https://your-api.com/api/mswipe/callback`
- [ ] Update `MSWIPE_REDIRECT_URL` to production frontend URL
- [ ] Update `FRONTEND_PAYMENT_RESULT_URL` to production frontend URL
- [ ] Test callback flow in UAT environment first
- [ ] Verify email delivery for successful donations

---

## Mswipe API Flow

### APIs Used:

| # | API | Endpoint | Purpose |
|---|-----|----------|---------|
| 1 | CreatePBLAuthToken | `/ipg/api/CreatePBLAuthToken` | Generate session token |
| 2 | MswipePayment | `/ipg/api/MswipePayment` | Create payment link (smslink) |
| 3 | getPBLTransactionDetails | `/ipg/api/getPBLTransactionDetails` | Check transaction status |
| 4 | BackPosting | Your callback URL | Receive payment notifications |

---

## Payment Flow Diagram

```
┌─────────┐                ┌─────────┐                ┌─────────┐
│ Frontend│                │ Backend │                │ Mswipe  │
└────┬────┘                └────┬────┘                └────┬────┘
     │                          │                          │
     │ POST /api/mswipe/initiate│                          │
     │ (donation details)       │                          │
     │─────────────────────────>│                          │
     │                          │                          │
     │                          │ Create Donation (PENDING)│
     │                          │                          │
     │                          │ POST /api/IPGPurchase    │
     │                          │─────────────────────────>│
     │                          │                          │
     │                          │ Return paymentUrl        │
     │                          │<─────────────────────────│
     │                          │                          │
     │ { paymentUrl, ref }      │                          │
     │<─────────────────────────│                          │
     │                          │                          │
     │ Redirect user to Mswipe  │                          │
     │─────────────────────────────────────────────────────>│
     │                          │                          │
     │          User completes payment                     │
     │                          │                          │
     │                          │ POST /api/mswipe/callback│
     │                          │<─────────────────────────│
     │                          │                          │
     │                          │ Verify callback          │
     │                          │ Update to SUCCESS/FAILED │
     │                          │ Send email (if SUCCESS)  │
     │                          │                          │
     │ Redirect to frontend     │                          │
     │<─────────────────────────│                          │
     │                          │                          │
```

---

## Security Considerations

### 1. Payment Status Trust
- **Never accept payment status from frontend**
- Payment confirmation occurs **ONLY** via Mswipe callback
- Frontend receives only `paymentUrl` - cannot manipulate payment

### 2. Callback Verification
```javascript
// Only update PENDING donations
if (donation.paymentStatus !== 'PENDING') {
  // Reject - prevents replay attacks
}

// Verify amount matches
if (callbackAmount !== donation.amount) {
  // Mark as FAILED
}
```

### 3. Credential Protection
- All Mswipe credentials stored in environment variables
- Never logged or exposed to frontend
- Session tokens rotated periodically

### 4. Rate Limiting
- Payment initiation limited to 5 requests per 15 minutes
- Prevents abuse and excessive failed attempts

---

## Email Behavior Changes

### Before (Manual Flow):
- Email sent immediately on donation creation
- Assumed payment completed externally

### After (Mswipe Flow):
- **No email at creation** (donation is PENDING)
- Email sent **ONLY** after successful Mswipe callback
- Email includes:
  - Donation reference
  - Mswipe transaction ID
  - Amount and date
  - Professional HTML formatting

**Email Template:**
```html
<h2>Thank You for Your Donation</h2>
<p>Dear <strong>{fullName}</strong>,</p>
<p>Thank you for your generous donation of <strong>Rs. {amount}</strong>.</p>
<div style="background-color: #f5f5f5; padding: 15px;">
  <p><strong>Donation Reference:</strong> {donationRef}</p>
  <p><strong>Transaction ID:</strong> {mswipeTransactionRef}</p>
  <p><strong>Amount:</strong> Rs. {amount}</p>
  <p><strong>Date:</strong> {date}</p>
</div>
```

---

## Export & Reporting Changes

### Donation Export CSV
**New Columns Added:**
- `Payment Gateway` (manual/mswipe)
- `Payment Status` (PENDING/SUCCESS/FAILED)
- `Mswipe Order ID`
- `Transaction ID` (manual transactionId OR mswipeTransactionRef)

**Filter Behavior:**
```javascript
// IMPORTANT: Only export successful donations
query.paymentStatus = 'SUCCESS';
```

**Exported Records:**
- ✅ Manual donations (legacy)
- ✅ Mswipe SUCCESS donations
- ❌ Mswipe PENDING donations
- ❌ Mswipe FAILED donations

### Statistics Dashboard
**Updated Aggregation:**
```javascript
{
  pendingCount: { paymentStatus: 'PENDING' },
  successCount: { paymentStatus: 'SUCCESS' },
  failedCount: { paymentStatus: 'FAILED' }
}
```

---

## Migration & Backward Compatibility

### Historical Data Preservation
- Existing manual donations remain valid
- `transactionId` preserved for old records
- `paymentGateway` defaults to 'mswipe' for new records

### Field Mapping
| Old Field | New Field | Notes |
|-----------|-----------|-------|
| `status: 'completed'` | `paymentStatus: 'SUCCESS'` | Both maintained |
| `status: 'pending'` | `paymentStatus: 'PENDING'` | Both maintained |
| `transactionId` | `mswipeTransactionRef` | Separate fields |

### Validation Updates
```javascript
// OLD: transactionId always required
requiredFields = [..., 'transactionId']

// NEW: Conditional based on gateway
if (paymentGateway === 'manual') {
  // Require transactionId
} else {
  // Skip transactionId validation
}
```

---

## Testing

### Test Payment Initiation
```bash
curl -X POST http://localhost:5002/api/mswipe/initiate \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Test User",
    "email": "test@example.com",
    "phoneNumber": "9876543210",
    "amount": 100,
    "state": "Maharashtra",
    "city": "Mumbai",
    "pinCode": "400001",
    "address": "Test Address",
    "seek80G": "no",
    "reasonForDonation": "General Donation"
  }'
```

### Test Callback (Simulate Mswipe)
```bash
curl -X POST http://localhost:5002/api/mswipe/callback \
  -H "Content-Type: application/json" \
  -d '{
    "invoiceId": "MSWP1705420800001",
    "transactionId": "TEST_TXN_123",
    "status": "success",
    "amount": "100"
  }'
```

### Check Donation Status
```bash
curl http://localhost:5002/api/mswipe/status/CMV1705420800001
```

---

## Troubleshooting

### Issue: Payment URL not returned
**Cause:** Mswipe API configuration error  
**Solution:** Check environment variables, verify credentials

### Issue: Callback not updating donation
**Cause:** 
- Donation not found (wrong orderId)
- Donation already processed (not PENDING)
- Amount mismatch

**Solution:** Check logs for specific error

### Issue: Email not sent after payment
**Cause:** 
- Email service error (non-blocking)
- Payment failed (email only for SUCCESS)

**Solution:** Check email service logs, verify SMTP configuration

### Issue: Export includes PENDING donations
**Cause:** Code not updated or filter overridden  
**Solution:** Verify `query.paymentStatus = 'SUCCESS'` in export service

---

## Production Deployment Checklist

- [ ] Configure production Mswipe credentials
- [ ] Update callback URL in .env to production backend
- [ ] Update frontend result URL to production domain
- [ ] Configure callback URL in Mswipe merchant dashboard
- [ ] Test complete payment flow in staging
- [ ] Verify email delivery with production SMTP
- [ ] Test callback handling with real Mswipe transactions
- [ ] Monitor logs for callback errors
- [ ] Set up alerts for failed payments
- [ ] Document rollback procedure

---

## File Structure

```
src/
├── controllers/
│   ├── donationController.js     # LEGACY manual donations
│   └── mswipeController.js       # NEW Mswipe payment flow
├── models/
│   └── Donation.js               # Extended with Mswipe fields
├── routes/
│   ├── donation.js               # LEGACY route
│   ├── mswipeRoutes.js           # NEW Mswipe routes
│   └── index.js                  # Updated with mswipe registration
├── services/
│   ├── mswipeService.js          # NEW Mswipe API integration
│   ├── donationExportService.js  # Updated with SUCCESS filter
│   └── emailService.js           # Used for success emails
└── middleware/
    └── validateDonation.js       # Updated conditional validation
```

---

## Support & Maintenance

**Developer Contact:** Backend Team  
**Mswipe Support:** Mswipe Technical Support  
**Payment Issues:** Check backend logs at `/logs/` directory

**Log Locations:**
- Payment initiation: `Mswipe donation initiated: {donationRef}`
- Callback received: `Mswipe callback received: {orderId}`
- Status updates: `Donation {donationRef} updated to {status}`
- Errors: `Mswipe API error` / `Mswipe callback handler error`

---

## Next Steps

1. **Configure Mswipe credentials** from merchant dashboard
2. **Test in staging** with real Mswipe test environment
3. **Update frontend** to integrate with `/api/mswipe/initiate`
4. **Monitor production** for callback delivery and email sending
5. **Set up analytics** to track payment success rates

---

**Last Updated:** January 16, 2026  
**Version:** 1.0  
**Status:** Production Ready
