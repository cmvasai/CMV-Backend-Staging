const Donation = require('../models/Donation');
const logger = require('../utils/logger');
const crypto = require('crypto');

function generateDonationRef() {
  return 'CMV' + Date.now() + Math.floor(Math.random() * 10000);
}

/**
 * LEGACY ENDPOINT: Manual donation creation
 * This endpoint is deprecated and kept only for backward compatibility.
 * New donations should use /api/mswipe/initiate endpoint.
 * 
 * This creates donations with paymentGateway='manual' and paymentStatus='SUCCESS'
 * assuming the payment was completed externally (QR/UPI).
 */
exports.createDonation = async (req, res) => {
  try {
    const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';
    const donationRef = generateDonationRef();
    const donationData = {
      ...req.body,
      amount: Number(req.body.amount),
      donationRef,
      paymentGateway: 'manual', // LEGACY: Mark as manual payment
      paymentStatus: 'SUCCESS', // LEGACY: Assume payment completed externally
      status: 'completed', // LEGACY: Keep old status field for compatibility
      ipAddress,
      userAgent
    };
    const donation = new Donation(donationData);
    await donation.save();
    logger.info(`LEGACY Manual donation submitted: ${donationRef} by ${donation.email}`);
    // NOTE: Email sending removed - will only be triggered via Mswipe callback
    // For manual donations, email should be sent separately if needed
    return res.status(201).json({ 
      donationId: donation._id, 
      donationRef,
      message: 'Manual donation recorded. Please use /api/mswipe/initiate for new donations.'
    });
  } catch (err) {
    logger.error('Donation submission error', err);
    if (err.code === 11000 && err.keyPattern && err.keyPattern.transactionId) {
      return res.status(409).json({ error: 'Duplicate transaction ID' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
};
