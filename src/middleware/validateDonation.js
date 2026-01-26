const validator = require('validator');
const Donation = require('../models/Donation');

const allowedReasons = [
  'Gurudakshina', 'General Donation', 'Event Sponsorship', 'Building Fund',
  'Educational Support', 'Community Service', 'Special Occasion', 'Other'
];

const allowedStates = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry'
];

function sanitizeInput(input) {
  if (typeof input === 'string') {
    return validator.escape(input.trim());
  }
  return input;
}

module.exports = async function validateDonation(req, res, next) {
  try {
    const body = req.body;
    const errors = [];
    // Required fields (transactionId removed - only required for manual donations)
    const requiredFields = [
      'fullName', 'email', 'phoneNumber', 'state', 'city', 'pinCode', 'address',
      'seek80G', 'amount', 'reasonForDonation'
    ];
    requiredFields.forEach(field => {
      if (!body[field] || (typeof body[field] === 'string' && !body[field].trim())) {
        errors.push(`${field} is required`);
      }
    });
    // Email
    if (body.email && !validator.isEmail(body.email)) {
      errors.push('Invalid email format');
    }
    // Phone number
    if (body.phoneNumber && !/^[0-9]{10}$/.test(body.phoneNumber)) {
      errors.push('Phone number must be exactly 10 digits');
    }
    // Pin code
    if (body.pinCode && !/^[0-9]{6}$/.test(body.pinCode)) {
      errors.push('Pin code must be exactly 6 digits');
    }
    // Amount
    if (body.amount && (!validator.isNumeric(body.amount.toString()) || Number(body.amount) <= 0)) {
      errors.push('Amount must be a positive number');
    }
    // State
    if (body.state && !allowedStates.includes(body.state)) {
      errors.push('Invalid Indian state');
    }
    // Reason for donation
    if (body.reasonForDonation && !allowedReasons.includes(body.reasonForDonation)) {
      errors.push('Invalid reason for donation');
    }
    // seek80G
    if (body.seek80G && !['yes', 'no'].includes(body.seek80G)) {
      errors.push('seek80G must be "yes" or "no"');
    }
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    // Sanitize all string fields
    Object.keys(body).forEach(key => {
      if (typeof body[key] === 'string') {
        body[key] = sanitizeInput(body[key]);
      }
    });
    // LEGACY: Transaction ID validation only for manual donations
    const paymentGateway = body.paymentGateway || 'manual';
    if (paymentGateway === 'manual') {
      if (!body.transactionId || !body.transactionId.trim()) {
        errors.push('transactionId is required for manual donations');
      } else {
        // Check uniqueness for manual donations
        const existing = await Donation.findOne({ transactionId: body.transactionId });
        if (existing) {
          return res.status(409).json({ error: 'Duplicate transaction ID' });
        }
      }
    }
    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }
    next();
  } catch (err) {
    next(err);
  }
};
