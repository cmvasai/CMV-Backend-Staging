const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Mswipe Payment Gateway Service
 * Based on official Mswipe PBL (Pay By Link) API Documentation
 * https://docs.mswipe.com/#/Gettingstarted
 * 
 * Flow:
 * 1. generateToken() - Get session token using credentials
 * 2. createOrder() - Create payment link for user
 * 3. verifyCallback() - Validate BackPosting data from Mswipe
 * 4. checkTransactionStatus() - Verify payment status (optional)
 */
class MswipeService {
  constructor() {
    // Environment configuration
    this.isProduction = process.env.MSWIPE_ENV === 'production';
    
    // API URLs based on environment
    this.baseUrl = this.isProduction 
      ? 'https://pbl.mswipe.com'
      : 'https://dcuat.mswipetech.co.in';
    
    // Credentials (from Mswipe)
    this.userId = process.env.MSWIPE_USER_ID;
    this.clientId = process.env.MSWIPE_CLIENT_ID;
    this.password = process.env.MSWIPE_PASSWORD;
    this.custCode = process.env.MSWIPE_CUST_CODE;
    
    // Fixed values as per Mswipe documentation
    this.applId = process.env.MSWIPE_APPL_ID || 'api';
    this.channelId = process.env.MSWIPE_CHANNEL_ID || 'pbl';
    this.versionNo = process.env.MSWIPE_VERSION || 'VER4.0.0';
    
    // Callback/Redirect URLs
    this.redirectUrl = process.env.MSWIPE_REDIRECT_URL;
    
    // Token caching
    this.cachedToken = null;
    this.tokenExpiry = null;

    // Validate configuration on startup
    if (!this.isConfigured()) {
      logger.warn('Mswipe configuration incomplete. Check environment variables: MSWIPE_USER_ID, MSWIPE_CLIENT_ID, MSWIPE_PASSWORD, MSWIPE_CUST_CODE');
    } else {
      logger.info(`Mswipe service initialized in ${this.isProduction ? 'PRODUCTION' : 'UAT'} mode`);
    }
  }

  /**
   * Check if Mswipe service is properly configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!(this.userId && this.clientId && this.password && this.custCode);
  }

  /**
   * Generate unique order ID for Mswipe transactions
   * Format: CMV{timestamp}{random}
   */
  generateOrderId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    return `CMV${timestamp}${random}`;
  }

  /**
   * Generate unique request ID (required to be unique per API call)
   */
  generateRequestId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
    return `REQ${timestamp}${random}`;
  }

  /**
   * Generate authentication token from Mswipe
   * Token should be cached and reused until expiry
   * 
   * API: POST /ipg/api/CreatePBLAuthToken
   * 
   * @returns {Promise<Object>} { success, token, error }
   */
  async generateToken() {
    try {
      // Check cached token validity (refresh 1 hour before expiry)
      if (this.cachedToken && this.tokenExpiry) {
        const now = Date.now();
        const bufferTime = 60 * 60 * 1000; // 1 hour buffer
        if (this.tokenExpiry > (now + bufferTime)) {
          logger.debug('Using cached Mswipe token');
          return { success: true, token: this.cachedToken };
        }
      }

      const url = `${this.baseUrl}/ipg/api/CreatePBLAuthToken`;
      
      const payload = {
        userId: this.userId,
        clientId: this.clientId,
        password: this.password,
        applId: this.applId,
        channelId: this.channelId
      };

      logger.info('Generating new Mswipe authentication token');

      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      const data = response.data;

      if (data.status === 'true' || data.status === true) {
        // Cache the token
        this.cachedToken = data.token;
        
        // Try to parse JWT expiry, default to 25 days if parsing fails
        try {
          const tokenPayload = JSON.parse(Buffer.from(data.token.split('.')[1], 'base64').toString());
          this.tokenExpiry = tokenPayload.exp * 1000; // Convert to milliseconds
        } catch (e) {
          // Default expiry: 25 days from now
          this.tokenExpiry = Date.now() + (25 * 24 * 60 * 60 * 1000);
        }

        logger.info('Mswipe token generated successfully');
        return { success: true, token: data.token };
      } else {
        logger.error('Mswipe token generation failed', data);
        return { 
          success: false, 
          error: data.msg || 'Token generation failed' 
        };
      }
    } catch (error) {
      logger.error('Mswipe token API error', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.response?.data?.msg || error.message || 'Token generation failed'
      };
    }
  }

  /**
   * Create payment link using Mswipe API
   * 
   * API: POST /ipg/api/MswipePayment
   * 
   * @param {Object} orderData - Order details
   * @param {string} orderData.name - Customer name
   * @param {string} orderData.email - Customer email
   * @param {string} orderData.mobile - Customer mobile (10 digits)
   * @param {number} orderData.amount - Amount in rupees
   * @param {string} orderData.orderId - Unique order ID (invoice_id)
   * @param {string} orderData.donationRef - CMV donation reference
   * @param {string} orderData.purpose - Donation purpose (optional)
   * @returns {Promise<Object>} { success, data: { paymentUrl, txnId, orderId }, error }
   */
  async createOrder(orderData) {
    try {
      const { name, email, mobile, amount, orderId, donationRef, purpose } = orderData;

      // Validate required fields
      if (!name || !email || !mobile || !amount || !orderId) {
        return {
          success: false,
          error: 'Missing required fields for payment link creation'
        };
      }

      // First, get a valid token
      const tokenResult = await this.generateToken();
      if (!tokenResult.success) {
        return {
          success: false,
          error: `Token generation failed: ${tokenResult.error}`
        };
      }

      const url = `${this.baseUrl}/ipg/api/MswipePayment`;
      
      // Generate unique request ID
      const requestId = this.generateRequestId();

      // Prepare payload as per Mswipe documentation
      const payload = {
        amount: amount.toString(),
        mobileno: mobile,
        custcode: this.custCode,
        user_id: this.userId,
        sessiontoken: tokenResult.token,
        versionno: this.versionNo,
        imeino: '',
        email_id: email,
        invoice_id: orderId,               // Our order ID for tracking
        request_id: requestId,              // Unique per request
        device_id: '',
        addlnote1: `Donation Ref: ${donationRef}`,
        addlnote2: `Donor: ${name}`,
        addlnote3: purpose || 'General Donation',
        addlnote4: '',
        addlnote5: '',
        addlnote6: '',
        addlnote7: '',
        addlnote8: '',
        addlnote9: '',
        addlnote10: '',
        LinkValidity: '',                   // Uses default validity
        paymentreason: 'Donation to Chinmaya Mission Vasai',
        redirect_url: this.redirectUrl || '',
        IsSendSMS: false,                   // We handle notifications ourselves
        ConvAllow: 'false',                 // Set true only if enabled by Mswipe
        ApplicationId: this.applId,
        ChannelId: this.channelId,
        ClientId: this.clientId
      };

      logger.info(`Creating Mswipe payment link: ${orderId} for Rs. ${amount}`);

      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      const data = response.data;

      // Check response status
      if (data.status === 'True' || data.status === true || data.status === 'true') {
        const paymentUrl = data.smslink;

        if (!paymentUrl) {
          logger.error('Mswipe payment link creation succeeded but no smslink returned', data);
          return {
            success: false,
            error: 'No payment link returned from Mswipe'
          };
        }

        // Extract TransID from smslink for later status checks
        let transId = null;
        try {
          const urlObj = new URL(paymentUrl);
          transId = urlObj.searchParams.get('TransID');
        } catch (e) {
          logger.warn('Could not extract TransID from payment link');
        }

        logger.info(`Mswipe payment link created: ${orderId} - IPG: ${data.txn_id}`);

        return {
          success: true,
          data: {
            paymentUrl: paymentUrl,
            txnId: data.txn_id,              // IPG_ID from Mswipe
            transId: transId,                // For status checks
            orderId: orderId,
            requestId: requestId,
            mswipeResponse: {
              txn_id: data.txn_id,
              responsecode: data.responsecode,
              responsemessage: data.responsemessage,
              messageContent: data.MessageContent,
              extraNotes: {
                note1: data.ExtraNote1,
                note2: data.ExtraNote2,
                note3: data.ExtraNote3,
                note4: data.ExtraNote4,
                note5: data.ExtraNote5
              }
            }
          }
        };
      } else {
        logger.error('Mswipe payment link creation failed', data);
        return {
          success: false,
          error: data.responsemessage || 'Payment link creation failed'
        };
      }
    } catch (error) {
      logger.error('Mswipe payment API error', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.response?.data?.responsemessage || error.message || 'Failed to create payment link'
      };
    }
  }

  /**
   * Verify BackPosting callback data from Mswipe
   * This is called when Mswipe posts payment result to our callback URL
   * 
   * @param {Object} callbackData - Data received from Mswipe BackPosting
   * @returns {Object} { valid, orderId, status, transactionRef, amount, error }
   */
  verifyCallback(callbackData) {
    try {
      logger.info('Verifying Mswipe callback data', { 
        ipgId: callbackData.IPG_ID,
        status: callbackData.TRAN_STATUS,
        invoiceNo: callbackData.ME_InvNo
      });

      // Extract relevant fields from BackPosting format
      const {
        IPG_ID,           // Mswipe transaction ID
        ME_InvNo,         // Our invoice_id (order ID)
        TRAN_STATUS,      // 'approved', 'declined', 'failed'
        TranAmount,       // Transaction amount
        RRN,              // Bank Reference Number
        CardType,         // visa, mastercard, rupay, etc.
        CardNumber,       // Masked card number
        DateTime,         // Transaction datetime (YYYYMMDDHHMMSS)
        RC,               // Response code
        RC_DESC,          // Response description
        CUST_EMAIL,
        CustMobNr,
        ME_NAME,
        MerID,
        TermID,
        WP_ID,
        EX_NOTES1,
        EX_NOTES2,
        EX_NOTES3,
        EX_NOTES4,
        EX_NOTES5
      } = callbackData;

      // Validate required fields
      if (!ME_InvNo && !IPG_ID) {
        return {
          valid: false,
          error: 'Missing order/invoice ID in callback'
        };
      }

      // Determine payment status based on TRAN_STATUS
      let paymentStatus = 'FAILED';
      if (TRAN_STATUS && TRAN_STATUS.toLowerCase() === 'approved') {
        paymentStatus = 'SUCCESS';
      } else if (TRAN_STATUS && TRAN_STATUS.toLowerCase() === 'pending') {
        paymentStatus = 'PENDING';
      }

      logger.info(`Mswipe callback verified: ${ME_InvNo} - Status: ${paymentStatus} (${TRAN_STATUS})`);

      return {
        valid: true,
        orderId: ME_InvNo,                    // Our order ID
        ipgId: IPG_ID,                        // Mswipe's IPG transaction ID
        status: paymentStatus,
        transactionRef: RRN || IPG_ID,        // Bank RRN or IPG_ID
        amount: TranAmount ? parseFloat(TranAmount) : null,
        cardType: CardType,
        cardNumber: CardNumber,
        responseCode: RC,
        responseDesc: RC_DESC,
        dateTime: DateTime,
        email: CUST_EMAIL,
        mobile: CustMobNr,
        merchantName: ME_NAME,
        merchantId: MerID,
        terminalId: TermID,
        wpId: WP_ID,
        extraNotes: {
          note1: EX_NOTES1,
          note2: EX_NOTES2,
          note3: EX_NOTES3,
          note4: EX_NOTES4,
          note5: EX_NOTES5
        },
        rawData: callbackData  // Store complete callback for debugging
      };
    } catch (error) {
      logger.error('Mswipe callback verification error', error);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Check transaction status using Mswipe API
   * Use this for verification or to check status manually
   * 
   * API: POST /ipg/api/getPBLTransactionDetails
   * 
   * @param {string} transId - TransID from payment link URL
   * @param {Object} options - Optional metadata (latitude, longitude, ip, userAgent)
   * @returns {Promise<Object>} { success, data, error }
   */
  async checkTransactionStatus(transId, options = {}) {
    try {
      if (!transId) {
        return {
          success: false,
          error: 'Transaction ID is required'
        };
      }

      const url = `${this.baseUrl}/ipg/api/getPBLTransactionDetails`;

      const payload = {
        id: transId,
        Latitude: options.latitude || '',
        Longitude: options.longitude || '',
        IP_Address: options.ipAddress || '',
        User_Agent: options.userAgent || ''
      };

      logger.info(`Checking Mswipe transaction status: ${transId}`);

      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      const data = response.data;

      if (data.Status === 'True' || data.Status === true) {
        const txnData = data.Data && data.Data[0];
        
        if (!txnData) {
          return {
            success: false,
            error: 'No transaction data returned'
          };
        }

        // Map Payment_Status: 2=Pending, 1=Success, 0=Failed
        let status = 'FAILED';
        if (txnData.Payment_Status === 1) {
          status = 'SUCCESS';
        } else if (txnData.Payment_Status === 2) {
          status = 'PENDING';
        }

        logger.info(`Transaction status for ${transId}: ${status}`);

        return {
          success: true,
          data: {
            ipgId: txnData.IPG_ID,
            amount: txnData.Amount,
            custCode: txnData.Cust_Code,
            merchantId: txnData.MID,
            terminalId: txnData.TID,
            status: status,
            statusCode: txnData.Payment_Status,
            statusDesc: txnData.Payment_Desc,
            orderId: txnData.Order_Id,
            paymentId: txnData.Payment_Id,  // RRN
            transactionDateTime: txnData.TrxDateTime,
            cardNumber: txnData.CardNumber,
            cardType: txnData.CardType,     // C=Credit, D=Debit
            paymentType: txnData.PaymentType,
            createdOn: txnData.Created_On
          }
        };
      } else {
        logger.error('Mswipe status check failed', data);
        return {
          success: false,
          error: data.ResponseMessage || 'Status check failed'
        };
      }
    } catch (error) {
      logger.error('Mswipe status API error', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });

      return {
        success: false,
        error: error.response?.data?.ResponseMessage || error.message || 'Status check failed'
      };
    }
  }

  /**
   * Force refresh the authentication token
   * Useful if token becomes invalid before expiry
   */
  async refreshToken() {
    this.cachedToken = null;
    this.tokenExpiry = null;
    return this.generateToken();
  }

  /**
   * Get current environment info (for debugging)
   */
  getEnvironmentInfo() {
    return {
      environment: this.isProduction ? 'production' : 'uat',
      baseUrl: this.baseUrl,
      configured: this.isConfigured(),
      hasValidToken: !!(this.cachedToken && this.tokenExpiry && this.tokenExpiry > Date.now())
    };
  }
}

// Export singleton instance
module.exports = new MswipeService();
