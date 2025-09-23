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
    limits: { fileSize: 5 * 1024 * 1024 },
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

// Update an announcement (Admin only)
router.put('/:id', upload.single('image'), async (req, res) => {
    try {
        const { title, content, targetGroups, targetOccupation, targetEducation, targetCivilStatus, targetIncome, eventDateTime } = req.body;
        
        // Find the announcement
        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) {
            return res.status(404).json({ error: 'Announcement not found' });
        }

        // Parse targetGroups if it's a string (from FormData)
        let parsedTargetGroups = [];
        try {
            parsedTargetGroups = typeof targetGroups === 'string' ? JSON.parse(targetGroups) : targetGroups || [];
        } catch (e) {
            parsedTargetGroups = [];
        }

        // Update announcement fields
        announcement.title = title || announcement.title;
        announcement.content = content || announcement.content;
        announcement.targetGroups = parsedTargetGroups;
        announcement.targetOccupation = targetOccupation || announcement.targetOccupation;
        announcement.targetEducation = targetEducation || announcement.targetEducation;
        announcement.targetCivilStatus = targetCivilStatus || announcement.targetCivilStatus;
        announcement.targetIncome = targetIncome || announcement.targetIncome;
        announcement.eventDateTime = eventDateTime ? new Date(eventDateTime) : announcement.eventDateTime;
        
        // Update image if a new one is provided
        if (req.file) {
            // Delete old image if it exists
            if (announcement.imageUrl) {
                const oldImagePath = path.join(__dirname, '../public', announcement.imageUrl);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlinkSync(oldImagePath);
                }
            }
            announcement.imageUrl = `/uploads/announcements/${req.file.filename}`;
        }

        await announcement.save();

        res.json(announcement);
    } catch (error) {
        console.error('Error updating announcement:', error);
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: 'Failed to update announcement' });
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

        await Announcement.findByIdAndDelete(req.params.id);

        res.json({ message: 'Announcement deleted successfully' });
    } catch (error) {
        console.error('Error deleting announcement:', error);
        res.status(500).json({ error: 'Failed to delete announcement' });
    }
});

// Add a comment to an announcement
router.post('/:id/comments', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ error: 'Comment text is required' });
        }

        // Get user info
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) {
            return res.status(404).json({ error: 'Announcement not found' });
        }

        // Check if the user is an admin
        const isAdmin = user.role === 'admin';
        const displayName = isAdmin ? 'Barangay Admin' : user.fullName;

        // Add comment
        announcement.comments.push({
            userId: req.session.userId,
            userName: displayName,
            text
        });

        await announcement.save();

        // Emit socket event for real-time updates
        if (req.app.get('io')) {
            req.app.get('io').emit('new_comment', {
                announcementId: req.params.id,
                comment: announcement.comments[announcement.comments.length - 1]
            });
        }

        res.status(201).json(announcement.comments[announcement.comments.length - 1]);
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

// Get comments for an announcement
router.get('/:id/comments', async (req, res) => {
    try {
        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) {
            return res.status(404).json({ error: 'Announcement not found' });
        }

        res.json(announcement.comments);
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

// Add a reply to a comment
router.post('/:id/comments/:commentId/replies', async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ error: 'Reply text is required' });
        }

        // Get user info
        const user = await User.findById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const announcement = await Announcement.findById(req.params.id);
        if (!announcement) {
            return res.status(404).json({ error: 'Announcement not found' });
        }

        // Find the comment
        const comment = announcement.comments.id(req.params.commentId);
        if (!comment) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        // Check if the user is an admin
        const isAdmin = user.role === 'admin';
        const displayName = isAdmin ? 'Barangay Admin' : user.fullName;

        // Add reply
        comment.replies.push({
            userId: req.session.userId,
            userName: displayName,
            text
        });

        await announcement.save();

        // Emit socket event for real-time updates
        if (req.app.get('io')) {
            req.app.get('io').emit('new_reply', {
                announcementId: req.params.id,
                commentId: req.params.commentId,
                reply: comment.replies[comment.replies.length - 1]
            });
        }

        res.status(201).json(comment.replies[comment.replies.length - 1]);
    } catch (error) {
        console.error('Error adding reply:', error);
        res.status(500).json({ error: 'Failed to add reply' });
    }
});

// Cleanup expired announcements (can be called periodically)
router.post('/cleanup', async (req, res) => {
    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const oldAnnouncements = await Announcement.find({ 
            createdAt: { $lt: thirtyDaysAgo } 
        });
        
        // Delete associated images
        for (const announcement of oldAnnouncements) {
            if (announcement.imageUrl) {
                const imagePath = path.join(__dirname, '../public', announcement.imageUrl);
                if (fs.existsSync(imagePath)) {
                    fs.unlinkSync(imagePath);
                }
            }
        }
        
        // Delete from database
        const result = await Announcement.deleteMany({ 
            createdAt: { $lt: thirtyDaysAgo } 
        });
        
        res.json({ message: `Deleted ${result.deletedCount} old announcements` });
    } catch (error) {
        console.error('Error cleaning up announcements:', error);
        res.status(500).json({ error: 'Failed to clean up announcements' });
    }
});

module.exports = router;