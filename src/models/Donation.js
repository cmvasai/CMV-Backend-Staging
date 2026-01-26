const mongoose = require('mongoose');
const crypto = require('crypto');

const donationSchema = new mongoose.Schema({
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true, index: true },
  phoneNumber: { type: String, required: true, trim: true },
  panCardNumber: { type: String, set: v => v ? crypto.createHash('sha256').update(v).digest('hex') : undefined },
  state: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  pinCode: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  seek80G: { type: String, required: true, enum: ['yes', 'no'] },
  amount: { type: Number, required: true, min: 1 },
  // LEGACY: transactionId is now optional - only used for old manual donations
  transactionId: { type: String, unique: true, sparse: true, index: true },
  reasonForDonation: { type: String, required: true, enum: [
    'Gurudakshina', 'General Donation', 'Event Sponsorship', 'Building Fund', 'Educational Support', 'Community Service', 'Special Occasion', 'Other'
  ] },
  purpose: { type: String },
  donationRef: { type: String, required: true, unique: true, index: true },
  // LEGACY: status field kept for backward compatibility
  status: { type: String, default: 'pending', enum: ['pending', 'completed', 'failed'] },
  // NEW: Payment gateway integration fields
  paymentGateway: { type: String, enum: ['manual', 'mswipe'], default: 'mswipe' },
  paymentStatus: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED'], default: 'PENDING' },
  // Mswipe-specific fields
  mswipeOrderId: { type: String, sparse: true, index: true },
  mswipeTransactionRef: { type: String },     // RRN (Bank Reference Number) or IPG_ID
  mswipeIpgId: { type: String },              // Mswipe's IPG transaction ID
  mswipeTransId: { type: String },            // TransID from payment URL (for status checks)
  mswipePaymentResponse: { type: mongoose.Schema.Types.Mixed },
  ipAddress: { type: String },
  userAgent: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Note: transactionId unique sparse index is defined in schema field options
// donationRef unique index is defined in schema field options
// These explicit index() calls are redundant and removed to avoid conflicts

donationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Donation', donationSchema);
