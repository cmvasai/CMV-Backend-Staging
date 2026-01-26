const Donation = require('../models/Donation');
const mswipeService = require('../services/mswipeService');
const { sendDonationEmail } = require('../services/emailService');
const logger = require('../utils/logger');
const validator = require('validator');

/**
 * Generate unique donation reference
 * Format: CMV{timestamp}{random}
 */
function generateDonationRef() {
  return 'CMV' + Date.now() + Math.floor(Math.random() * 10000);
}

/**
 * Sanitize input string
 */
function sanitizeInput(input) {
  if (typeof input === 'string') {
    return validator.escape(input.trim());
  }
  return input;
}

/**
 * Initiate Mswipe payment
 * Creates a pending donation and returns Mswipe payment URL
 * 
 * POST /api/mswipe/initiate
 * Body: { fullName, email, phoneNumber, amount, state, city, pinCode, address, seek80G, reasonForDonation, purpose }
 * 
 * SECURITY: 
 * - Never trust frontend payment status
 * - Payment confirmation occurs ONLY in callback
 * - This endpoint creates PENDING donations only
 */
exports.initiatePayment = async (req, res) => {
  try {
    // Check if Mswipe is configured
    if (!mswipeService.isConfigured()) {
      logger.error('Mswipe service not configured');
      return res.status(503).json({ 
        error: 'Payment service temporarily unavailable' 
      });
    }

    // Extract and sanitize input
    const {
      fullName,
      email,
      phoneNumber,
      amount,
      state,
      city,
      pinCode,
      address,
      seek80G,
      reasonForDonation,
      purpose,
      panCardNumber
    } = req.body;

    // Basic validation (detailed validation in middleware)
    const errors = [];
    if (!fullName || !fullName.trim()) errors.push('fullName is required');
    if (!email || !validator.isEmail(email)) errors.push('Valid email is required');
    if (!phoneNumber || !/^[0-9]{10}$/.test(phoneNumber)) errors.push('Valid 10-digit phone number is required');
    if (!amount || amount <= 0) errors.push('Amount must be greater than 0');

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    // Capture metadata
    const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    // Generate unique identifiers
    const donationRef = generateDonationRef();
    const mswipeOrderId = mswipeService.generateOrderId();

    // Create pending donation record
    const donationData = {
      fullName: sanitizeInput(fullName),
      email: sanitizeInput(email),
      phoneNumber: sanitizeInput(phoneNumber),
      state: sanitizeInput(state),
      city: sanitizeInput(city),
      pinCode: sanitizeInput(pinCode),
      address: sanitizeInput(address),
      seek80G: seek80G,
      amount: Number(amount),
      reasonForDonation: reasonForDonation,
      purpose: sanitizeInput(purpose),
      panCardNumber: panCardNumber, // Will be hashed by model
      donationRef,
      paymentGateway: 'mswipe',
      paymentStatus: 'PENDING',
      status: 'pending', // Legacy field
      mswipeOrderId,
      ipAddress,
      userAgent
    };

    const donation = new Donation(donationData);
    await donation.save();

    logger.info(`Mswipe donation initiated: ${donationRef} (Order: ${mswipeOrderId}) by ${email}`);

    // Call Mswipe API to create payment link
    const mswipeResult = await mswipeService.createOrder({
      name: fullName,
      email: email,
      mobile: phoneNumber,
      amount: Number(amount),
      orderId: mswipeOrderId,
      donationRef: donationRef,
      purpose: purpose || reasonForDonation
    });

    if (!mswipeResult.success) {
      // Mark donation as failed
      donation.paymentStatus = 'FAILED';
      donation.status = 'failed';
      await donation.save();

      logger.error(`Mswipe order creation failed for ${donationRef}: ${mswipeResult.error}`);
      return res.status(500).json({ 
        error: 'Failed to initiate payment',
        donationRef // Return reference for support queries
      });
    }

    // Store Mswipe response (includes IPG_ID, transId for status checks)
    donation.mswipePaymentResponse = mswipeResult.data.mswipeResponse;
    donation.mswipeIpgId = mswipeResult.data.txnId;      // IPG_ID from Mswipe
    donation.mswipeTransId = mswipeResult.data.transId;  // TransID for status checks
    await donation.save();

    // Return payment URL - frontend will redirect user
    return res.status(200).json({
      success: true,
      paymentUrl: mswipeResult.data.paymentUrl,
      donationRef,
      orderId: mswipeOrderId
    });

  } catch (err) {
    logger.error('Mswipe initiate payment error', err);
    
    // Handle duplicate donation reference (unlikely but possible)
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate order detected. Please try again.' });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Handle Mswipe BackPosting callback
 * Updates donation status based on payment result
 * 
 * POST /api/mswipe/callback
 * Body: Mswipe BackPosting data (see documentation for structure)
 * 
 * SECURITY CRITICAL:
 * - Only trust data from Mswipe callback
 * - Verify order ID matches pending donation
 * - Prevent replay attacks by checking current status
 * - Only update PENDING donations
 * - Never accept payment status from frontend
 */
exports.handleCallback = async (req, res) => {
  try {
    const callbackData = req.body;
    
    logger.info('Mswipe BackPosting callback received', { 
      ipgId: callbackData.IPG_ID,
      invoiceNo: callbackData.ME_InvNo,
      status: callbackData.TRAN_STATUS,
      amount: callbackData.TranAmount
    });

    // Verify callback data using the new BackPosting format
    const verification = mswipeService.verifyCallback(callbackData);
    
    if (!verification.valid) {
      logger.error('Invalid Mswipe callback', verification.error);
      return res.status(400).json({ error: 'Invalid callback data' });
    }

    // Find donation by Mswipe order ID (ME_InvNo = our invoice_id = mswipeOrderId)
    const donation = await Donation.findOne({ 
      mswipeOrderId: verification.orderId 
    });

    if (!donation) {
      logger.error(`Donation not found for Mswipe order: ${verification.orderId}`);
      return res.status(404).json({ error: 'Donation not found' });
    }

    // SECURITY: Only update donations that are currently PENDING
    // This prevents replay attacks and duplicate callbacks
    if (donation.paymentStatus !== 'PENDING') {
      logger.warn(`Attempted to update non-pending donation: ${donation.donationRef} (Current status: ${donation.paymentStatus})`);
      
      // Redirect to frontend anyway (callback might be duplicate)
      const frontendUrl = process.env.FRONTEND_PAYMENT_RESULT_URL;
      if (frontendUrl) {
        return res.redirect(`${frontendUrl}?status=${donation.paymentStatus.toLowerCase()}&ref=${donation.donationRef}`);
      }
      
      return res.status(200).json({ 
        message: 'Donation already processed',
        status: donation.paymentStatus 
      });
    }

    // Verify amount matches (additional security check)
    if (verification.amount && Number(verification.amount) !== donation.amount) {
      logger.error(`Amount mismatch for ${donation.donationRef}: Expected ${donation.amount}, got ${verification.amount}`);
      donation.paymentStatus = 'FAILED';
      donation.status = 'failed';
      await donation.save();
      return res.status(400).json({ error: 'Amount verification failed' });
    }

    // Update donation status based on payment result
    donation.paymentStatus = verification.status;
    donation.status = verification.status === 'SUCCESS' ? 'completed' : 'failed';
    donation.mswipeTransactionRef = verification.transactionRef;  // RRN or IPG_ID
    donation.mswipeIpgId = verification.ipgId;                    // IPG_ID
    donation.mswipePaymentResponse = {
      ...donation.mswipePaymentResponse,
      callback: {
        ipgId: verification.ipgId,
        transactionRef: verification.transactionRef,
        cardType: verification.cardType,
        cardNumber: verification.cardNumber,
        responseCode: verification.responseCode,
        responseDesc: verification.responseDesc,
        dateTime: verification.dateTime,
        merchantId: verification.merchantId,
        terminalId: verification.terminalId,
        extraNotes: verification.extraNotes,
        rawStatus: callbackData.TRAN_STATUS
      }
    };
    donation.updatedAt = new Date();

    await donation.save();

    logger.info(`Donation ${donation.donationRef} updated to ${donation.paymentStatus} (IPG: ${verification.ipgId}, RRN: ${verification.transactionRef})`);

    // Send success email ONLY for successful payments
    if (donation.paymentStatus === 'SUCCESS') {
      try {
        await sendDonationEmail({
          to: donation.email,
          subject: 'Thank you for your donation - Chinmaya Mission Vasai',
          text: `Dear ${donation.fullName},\n\nThank you for your generous donation of Rs. ${donation.amount}.\n\nYour donation reference number is: ${donation.donationRef}\nTransaction ID: ${donation.mswipeTransactionRef}\n\nYour support helps us continue our mission.\n\nWith gratitude,\nChinmaya Mission Vasai`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #ff6600;">Thank You for Your Donation</h2>
              <p>Dear <strong>${donation.fullName}</strong>,</p>
              <p>Thank you for your generous donation of <strong>Rs. ${donation.amount}</strong>.</p>
              <div style="background-color: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #ff6600;">
                <p style="margin: 5px 0;"><strong>Donation Reference:</strong> ${donation.donationRef}</p>
                <p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${donation.mswipeTransactionRef}</p>
                <p style="margin: 5px 0;"><strong>Amount:</strong> Rs. ${donation.amount}</p>
                <p style="margin: 5px 0;"><strong>Date:</strong> ${new Date(donation.updatedAt).toLocaleDateString('en-IN')}</p>
              </div>
              <p>Your support helps us continue our mission to spread knowledge and serve the community.</p>
              <p style="margin-top: 30px;">With gratitude,<br><strong>Chinmaya Mission Vasai</strong></p>
            </div>
          `
        });
        logger.info(`Success email sent to ${donation.email}`);
      } catch (emailErr) {
        logger.error('Failed to send donation success email', emailErr);
        // Don't fail the callback if email fails
      }
    }

    // Redirect to frontend payment result page
    const frontendUrl = process.env.FRONTEND_PAYMENT_RESULT_URL;
    if (frontendUrl) {
      const status = donation.paymentStatus.toLowerCase();
      const redirectUrl = `${frontendUrl}?status=${status}&ref=${donation.donationRef}&amount=${donation.amount}`;
      logger.info(`Redirecting to frontend: ${redirectUrl}`);
      return res.redirect(redirectUrl);
    }

    // Fallback: Return JSON if no redirect URL configured
    return res.status(200).json({
      success: donation.paymentStatus === 'SUCCESS',
      status: donation.paymentStatus,
      donationRef: donation.donationRef,
      message: donation.paymentStatus === 'SUCCESS' 
        ? 'Payment successful' 
        : 'Payment failed'
    });

  } catch (err) {
    logger.error('Mswipe callback handler error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get donation status by reference
 * Allows frontend to check payment status
 * 
 * GET /api/mswipe/status/:donationRef
 */
exports.getDonationStatus = async (req, res) => {
  try {
    const { donationRef } = req.params;

    if (!donationRef) {
      return res.status(400).json({ error: 'Donation reference is required' });
    }

    const donation = await Donation.findOne({ donationRef })
      .select('donationRef paymentStatus amount createdAt updatedAt mswipeTransactionRef mswipeOrderId mswipeIpgId');

    if (!donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    return res.status(200).json({
      donationRef: donation.donationRef,
      status: donation.paymentStatus,
      amount: donation.amount,
      transactionRef: donation.mswipeTransactionRef,
      ipgId: donation.mswipeIpgId,
      createdAt: donation.createdAt,
      updatedAt: donation.updatedAt
    });

  } catch (err) {
    logger.error('Get donation status error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Verify transaction status with Mswipe API
 * Use this to manually verify payment status if callback was missed
 * 
 * POST /api/mswipe/verify/:donationRef
 */
exports.verifyTransaction = async (req, res) => {
  try {
    const { donationRef } = req.params;

    if (!donationRef) {
      return res.status(400).json({ error: 'Donation reference is required' });
    }

    const donation = await Donation.findOne({ donationRef });

    if (!donation) {
      return res.status(404).json({ error: 'Donation not found' });
    }

    // Get transId stored during payment initiation
    const transId = donation.mswipeTransId;
    
    if (!transId) {
      return res.status(400).json({ 
        error: 'Transaction ID not available for verification',
        status: donation.paymentStatus
      });
    }

    // Call Mswipe API to check transaction status
    const statusResult = await mswipeService.checkTransactionStatus(transId, {
      ipAddress: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent']
    });

    if (!statusResult.success) {
      logger.error(`Mswipe status check failed for ${donationRef}: ${statusResult.error}`);
      return res.status(500).json({ 
        error: 'Failed to verify transaction status',
        currentStatus: donation.paymentStatus
      });
    }

    const mswipeStatus = statusResult.data.status;

    // If status changed from PENDING, update the donation
    if (donation.paymentStatus === 'PENDING' && mswipeStatus !== 'PENDING') {
      donation.paymentStatus = mswipeStatus;
      donation.status = mswipeStatus === 'SUCCESS' ? 'completed' : 'failed';
      donation.mswipeTransactionRef = statusResult.data.paymentId || statusResult.data.ipgId;
      donation.mswipeIpgId = statusResult.data.ipgId;
      donation.mswipePaymentResponse = {
        ...donation.mswipePaymentResponse,
        statusCheck: statusResult.data
      };
      donation.updatedAt = new Date();
      await donation.save();

      logger.info(`Donation ${donationRef} updated via status check to ${mswipeStatus}`);

      // Send email for successful payments
      if (mswipeStatus === 'SUCCESS') {
        try {
          await sendDonationEmail({
            to: donation.email,
            subject: 'Thank you for your donation - Chinmaya Mission Vasai',
            text: `Dear ${donation.fullName},\n\nThank you for your generous donation of Rs. ${donation.amount}.\n\nYour donation reference number is: ${donation.donationRef}\nTransaction ID: ${donation.mswipeTransactionRef}\n\nYour support helps us continue our mission.\n\nWith gratitude,\nChinmaya Mission Vasai`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #ff6600;">Thank You for Your Donation</h2>
                <p>Dear <strong>${donation.fullName}</strong>,</p>
                <p>Thank you for your generous donation of <strong>Rs. ${donation.amount}</strong>.</p>
                <div style="background-color: #f5f5f5; padding: 15px; margin: 20px 0; border-left: 4px solid #ff6600;">
                  <p style="margin: 5px 0;"><strong>Donation Reference:</strong> ${donation.donationRef}</p>
                  <p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${donation.mswipeTransactionRef}</p>
                  <p style="margin: 5px 0;"><strong>Amount:</strong> Rs. ${donation.amount}</p>
                  <p style="margin: 5px 0;"><strong>Date:</strong> ${new Date(donation.updatedAt).toLocaleDateString('en-IN')}</p>
                </div>
                <p>Your support helps us continue our mission to spread knowledge and serve the community.</p>
                <p style="margin-top: 30px;">With gratitude,<br><strong>Chinmaya Mission Vasai</strong></p>
              </div>
            `
          });
          logger.info(`Success email sent to ${donation.email} (via status check)`);
        } catch (emailErr) {
          logger.error('Failed to send donation success email', emailErr);
        }
      }
    }

    return res.status(200).json({
      donationRef: donation.donationRef,
      status: donation.paymentStatus,
      mswipeStatus: statusResult.data,
      amount: donation.amount,
      transactionRef: donation.mswipeTransactionRef,
      updatedAt: donation.updatedAt
    });

  } catch (err) {
    logger.error('Verify transaction error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get Mswipe service environment info (for debugging)
 * 
 * GET /api/mswipe/info
 */
exports.getServiceInfo = async (req, res) => {
  try {
    const info = mswipeService.getEnvironmentInfo();
    return res.status(200).json(info);
  } catch (err) {
    logger.error('Get service info error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
