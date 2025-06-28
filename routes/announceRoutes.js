const express = require('express');
const Announcement = require('../models/Announcement');
const User = require('../models/User');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        const uploadDir = path.join(__dirname, '../public/uploads/announcements');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function(req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function(req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed (jpeg, jpg, png, gif)'));
    }
});

// Create a new announcement (Admin only)
router.post('/', upload.single('image'), async (req, res) => {
    try {
        const { title, content, targetGroups, targetOccupation, targetEducation, targetCivilStatus, targetIncome, eventDateTime } = req.body;
        
        // Validate input
        if (!title || !content || !eventDateTime) {
            // Delete uploaded file if validation fails
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            return res.status(400).json({ error: 'Title, content and event date/time are required' });
        }

        // Parse targetGroups if it's a string (from FormData)
        let parsedTargetGroups = [];
        try {
            parsedTargetGroups = typeof targetGroups === 'string' ? JSON.parse(targetGroups) : targetGroups || [];
        } catch (e) {
            parsedTargetGroups = [];
        }

        // Create new announcement
        const announcement = new Announcement({
            title,
            content,
            targetGroups: parsedTargetGroups,
            targetOccupation: targetOccupation || null,
            targetEducation: targetEducation || null,
            targetCivilStatus: targetCivilStatus || null,
            targetIncome: targetIncome || null,
            eventDateTime: new Date(eventDateTime),
            createdBy: req.session.userId,
            imageUrl: req.file ? `/uploads/announcements/${req.file.filename}` : null
        });

        await announcement.save();

        // Emit socket event for real-time updates
        if (req.app.get('io')) {
            req.app.get('io').emit('new_announcement', announcement);
        }

        res.status(201).json(announcement);
    } catch (error) {
        console.error('Error creating announcement:', error);
        // Delete uploaded file if error occurs
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Failed to create announcement' });
    }
});

// Get all announcements (Admin view)
router.get('/', async (req, res) => {
    try {
        const announcements = await Announcement.find().sort({ createdAt: -1 });
        res.json(announcements);
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).json({ error: 'Failed to fetch announcements' });
    }
});

// Get announcements for current user (filtered by their profile)
router.get('/user', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Get user profile
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Build query to find announcements relevant to this user
        const query = {
            $or: [
                { targetGroups: 'All Residents' },
                { targetGroups: { $size: 0 } }
            ]
        };

        // Add user-specific conditions based on their profile
        const userConditions = [];
        
        // Check special groups
        if (user.pwdMember) userConditions.push({ targetGroups: 'PWD Member' });
        if (user.seniorCitizen) userConditions.push({ targetGroups: 'Senior Citizen' });
        if (user.registeredVoter) userConditions.push({ targetGroups: 'Registered Voter' });
        if (user.fourPsMember) userConditions.push({ targetGroups: '4Ps Member' });
        if (user.soloParent) userConditions.push({ targetGroups: 'Solo Parent' });
        
        // Check occupation, education, civil status, income
        if (user.occupation) userConditions.push({ targetOccupation: user.occupation });
        if (user.educationalAttainment) userConditions.push({ targetEducation: user.educationalAttainment });
        if (user.civilStatus) userConditions.push({ targetCivilStatus: user.civilStatus });
        if (user.monthlyIncome) userConditions.push({ targetIncome: user.monthlyIncome });

        if (userConditions.length > 0) {
            query.$or = query.$or.concat(userConditions);
        }

        // Get announcements that match any of these conditions
        const announcements = await Announcement.find(query).sort({ createdAt: -1 });

        res.json(announcements);
    } catch (error) {
        console.error('Error fetching user announcements:', error);
        res.status(500).json({ error: 'Failed to fetch announcements' });
    }
});

// Get announcement by ID
router.get('/:id', async (req, res) => {
    try {
        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) {
            return res.status(404).json({ error: 'Announcement not found' });
        }
        res.json(announcement);
    } catch (error) {
        console.error('Error fetching announcement:', error);
        res.status(500).json({ error: 'Failed to fetch announcement' });
    }
});

// Delete an announcement (Admin only)
router.delete('/:id', async (req, res) => {
    try {
        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) {
            return res.status(404).json({ error: 'Announcement not found' });
        }

        // Delete associated image if it exists
        if (announcement.imageUrl) {
            const imagePath = path.join(__dirname, '../public', announcement.imageUrl);
            if (fs.existsSync(imagePath)) {
                fs.unlinkSync(imagePath);
            }
        }

        await announcement.remove();

        res.json({ message: 'Announcement deleted successfully' });
    } catch (error) {
        console.error('Error deleting announcement:', error);
        res.status(500).json({ error: 'Failed to delete announcement' });
    }
});

// Cleanup expired announcements (can be called periodically)
router.post('/cleanup', async (req, res) => {
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const expiredAnnouncements = await Announcement.find({ createdAt: { $lt: twentyFourHoursAgo } });
        
        // Delete associated images
        for (const announcement of expiredAnnouncements) {
            if (announcement.imageUrl) {
                const imagePath = path.join(__dirname, '../public', announcement.imageUrl);
                if (fs.existsSync(imagePath)) {
                    fs.unlinkSync(imagePath);
                }
            }
        }
        
        // Delete from database
        const result = await Announcement.deleteMany({ createdAt: { $lt: twentyFourHoursAgo } });
        
        res.json({ message: `Deleted ${result.deletedCount} expired announcements` });
    } catch (error) {
        console.error('Error cleaning up announcements:', error);
        res.status(500).json({ error: 'Failed to clean up announcements' });
    }
});

module.exports = router;