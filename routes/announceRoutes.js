const express = require('express');
const Announcement = require('../models/Announcement');
const User = require('../models/User');
const router = express.Router();

// Create a new announcement (Admin only)
router.post('/', async (req, res) => {
    try {
        const { title, content, targetGroups, occupation, education, civilStatus } = req.body;
        
        // Validate input
        if (!title || !content) {
            return res.status(400).json({ error: 'Title and content are required' });
        }

        // Create new announcement
        const announcement = new Announcement({
            title,
            content,
            targetGroups: targetGroups || [],
            occupation: occupation || '',
            education: education || '',
            civilStatus: civilStatus || '',
            createdBy: req.session.userId
        });

        await announcement.save();

        // Emit socket event for real-time updates
        if (req.app.get('io')) {
            req.app.get('io').emit('new_announcement', announcement);
        }

        res.status(201).json(announcement);
    } catch (error) {
        console.error('Error creating announcement:', error);
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
        if (user.pregnant) userConditions.push({ targetGroups: 'Pregnant' });
        if (user.registeredVoter) userConditions.push({ targetGroups: 'Registered Voter' });
        if (user.fourPsMember) userConditions.push({ targetGroups: '4Ps Member' });
        
        // Check occupation, education, civil status
        if (user.occupation) userConditions.push({ occupation: user.occupation });
        if (user.educationalAttainment) userConditions.push({ education: user.educationalAttainment });
        if (user.civilStatus) userConditions.push({ civilStatus: user.civilStatus });

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

// Delete an announcement (Admin only)
router.delete('/:id', async (req, res) => {
    try {
        const announcement = await Announcement.findByIdAndDelete(req.params.id);
        if (!announcement) {
            return res.status(404).json({ error: 'Announcement not found' });
        }

        res.json({ message: 'Announcement deleted successfully' });
    } catch (error) {
        console.error('Error deleting announcement:', error);
        res.status(500).json({ error: 'Failed to delete announcement' });
    }
});

module.exports = router;