const express = require('express');
const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const carouselRoutes = require('./carouselRoutes');
const upcomingEventRoutes = require('./upcomingEventRoutes');
const featuredEventRoutes = require('./featuredEventRoutes');
const archivedEventRoutes = require('./archivedEventRoutes');
const utilityRoutes = require('./utilityRoutes');
const donationRoutes = require('./donation');
const adminRoutes = require('./admin');
const cgcc2025Routes = require('./cgcc2025Routes');
const mswipeRoutes = require('./mswipeRoutes');

const router = express.Router();

router.use('/api', authRoutes);
router.use('/api', userRoutes);
router.use('/api/carousel-items', carouselRoutes);
router.use('/api/upcoming-events', upcomingEventRoutes);
router.use('/api/featured-events', featuredEventRoutes);
router.use('/api/archived-events', archivedEventRoutes);
router.use('/api', utilityRoutes);
router.use('/api/donations', donationRoutes);
router.use('/api/mswipe', mswipeRoutes); // Mswipe payment gateway routes
router.use('/api/admin', adminRoutes);
router.use('/api/cgcc2025', cgcc2025Routes);

module.exports = router;
