const express = require("express");
const Request = require("../models/Request");
const User = require("../models/User");
const { format, isValid, addDays, isAfter, isBefore, startOfDay, endOfDay } = require('date-fns');

const router = express.Router();

// Middleware to verify session
const verifySession = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ 
            error: "Unauthorized", 
            message: "Please log in to access this resource" 
        });
    }
    next();
};

// Middleware to verify user is not banned
const checkNotBanned = async (req, res, next) => {
    try {
        const user = await User.findById(req.session.userId);
        if (user?.isBanned) {
            return res.status(403).json({ 
                error: "Forbidden", 
                message: "Your account has been disabled. You cannot submit or manage requests." 
            });
        }
        next();
    } catch (error) {
        console.error("Error checking user ban status:", error);
        res.status(500).json({ 
            error: "Server error", 
            message: "Failed to verify account status" 
        });
    }
};

// Helper function to get user profile picture URL
const getUserProfilePicture = (user) => {
    if (!user) return '/images/default-profile.png';
    
    if (user.profilePicture) {
        if (user.profilePicture.startsWith('http') || user.profilePicture.startsWith('/')) {
            return user.profilePicture;
        } else {
            return '/uploads/' + user.profilePicture;
        }
    }
    return '/images/default-profile.png';
};

// UPDATED: Validate scheduled claim date and time
const validateScheduledClaim = (scheduledClaimDate, scheduledClaimTime) => {
    try {
        const now = new Date();
        const selectedDate = new Date(scheduledClaimDate);
        
        // Reset time part for date comparison only
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        
        const selectedDay = new Date(selectedDate);
        selectedDay.setHours(0, 0, 0, 0);

        console.log('Date validation:', {
            today: today.toISOString(),
            selectedDay: selectedDay.toISOString(),
            now: now.toISOString()
        });

        // Check if date is valid
        if (isNaN(selectedDate.getTime())) {
            return { valid: false, message: "Invalid date format" };
        }

        // Check if date is in the past
        if (selectedDay < today) {
            return { valid: false, message: "Cannot schedule claim for past dates" };
        }

        // Check if date is too far in the future (max 30 days)
        const maxDate = new Date(today);
        maxDate.setDate(maxDate.getDate() + 30);
        
        if (selectedDay > maxDate) {
            return { valid: false, message: "Cannot schedule claim more than 30 days in advance" };
        }

        // Validate time format (HH:MM)
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(scheduledClaimTime)) {
            return { valid: false, message: "Invalid time format. Use HH:MM (24-hour format)" };
        }

        // Check if scheduling for today but time has passed
        if (selectedDay.getTime() === today.getTime()) {
            const [hours, minutes] = scheduledClaimTime.split(':').map(Number);
            const selectedDateTime = new Date(selectedDate);
            selectedDateTime.setHours(hours, minutes, 0, 0);
            
            console.log('Time validation for today:', {
                selectedDateTime: selectedDateTime.toISOString(),
                now: now.toISOString(),
                isBefore: selectedDateTime < now
            });
            
            if (selectedDateTime < now) {
                return { valid: false, message: "Cannot schedule claim for past times today" };
            }
        }

        // Validate office hours (8 AM - 4 PM)
        const [hours, minutes] = scheduledClaimTime.split(':').map(Number);
        if (hours < 8 || hours > 16) {
            return { valid: false, message: "Please select a time between 8:00 AM and 4:00 PM" };
        }
        
        // If it's exactly 4:00 PM, it's valid
        if (hours === 16 && minutes === 0) {
            return { valid: true };
        }
        
        // If it's after 4:00 PM, it's invalid
        if (hours === 16 && minutes > 0) {
            return { valid: false, message: "Office hours end at 4:00 PM" };
        }

        return { valid: true };
    } catch (error) {
        console.error('Validation error:', error);
        return { valid: false, message: "Invalid date or time format" };
    }
};

// Create a new document request
router.post("/", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { fullName, address, documentTypes, purpose } = req.body;

        // Basic validation
        if (!fullName || !address || !documentTypes || !purpose) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "All fields are required" 
            });
        }

        if (!Array.isArray(documentTypes)) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "Document types must be an array" 
            });
        }

        if (documentTypes.length === 0) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "At least one document type must be selected" 
            });
        }

        // Create new request
        const newRequest = new Request({
            fullName,
            email: req.session.userEmail,
            address,
            documentTypes,
            purpose,
            status: "Pending",
            userId: req.session.userId
        });

        await newRequest.save();

        // Format dates for response
        const createdAt = new Date(newRequest.createdAt);
        const formattedRequest = {
            ...newRequest.toObject(),
            id: newRequest._id.toString(),
            formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
            formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time'
        };

        // Emit real-time update
        req.app.get('io').emit('request-update', {
            type: 'created',
            request: formattedRequest
        });

        res.status(201).json({
            message: "Request submitted successfully!",
            request: formattedRequest
        });
    } catch (error) {
        console.error("Error submitting request:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to submit request. Please try again later." 
        });
    }
});

// Get all requests (admin view)
router.get("/", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { status, documentType, startDate, endDate, search, archive } = req.query;
        let query = {};

        // Build query based on parameters
        if (archive === 'true') {
            query.status = { $in: ['Approved', 'Rejected', 'Claimed'] };
        } else {
            query.status = status || { $in: ['Pending', 'Approved', 'Ready to Claim', 'Scheduled for Pickup'] };
        }

        if (documentType) {
            query.documentTypes = documentType;
        }

        if (startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
            };
        }

        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }

        // Fetch requests with user data populated
        const requests = await Request.find(query)
            .populate('userId', 'fullName profilePicture') // Populate user data
            .sort({ createdAt: -1 })
            .lean();

        // Format response
        const formattedRequests = requests.map(request => {
            const createdAt = new Date(request.createdAt);
            const updatedAt = new Date(request.updatedAt);
            
            // Get user data if populated
            const userProfile = request.userId ? {
                profilePicture: getUserProfilePicture(request.userId),
                fullName: request.userId.fullName || request.fullName || 'Unknown User'
            } : {
                profilePicture: '/images/default-profile.png',
                fullName: request.fullName || 'Unknown User'
            };

            return {
                ...request,
                id: request._id.toString(),
                documentType: Array.isArray(request.documentTypes) 
                    ? request.documentTypes.join(', ') 
                    : request.documentTypes || 'N/A',
                formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
                formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time',
                formattedScheduledDate: request.scheduledClaimDate ? 
                    format(new Date(request.scheduledClaimDate), 'MMM dd, yyyy') : 'Not scheduled',
                formattedScheduledTime: request.scheduledClaimTime || 'Not scheduled',
                updatedAt: isValid(updatedAt) ? updatedAt : new Date(),
                userProfile: userProfile
            };
        });

        res.status(200).json(formattedRequests);
    } catch (error) {
        console.error("Error fetching requests:", error);
        res.status(500).json({ 
            error: "Server error",
            message: error.message 
        });
    }
});

// Get requests for logged-in user (UPDATED to include scheduled for pickup)
router.get("/user", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { archive } = req.query;
        let query = { userId: req.session.userId };

        // If archive=true, show only claimed requests
        // If archive=false or not provided, show active requests (excluding claimed)
        if (archive === 'true') {
            query.status = { $in: ["Scheduled for Pickup", "Claimed"] };
        } else {
            query.status = { $nin: ["Claimed"] };
        }

        const requests = await Request.find(query)
            .populate('userId', 'fullName profilePicture')
            .sort({ createdAt: -1 })
            .lean();

        const formattedRequests = requests.map(request => {
            const createdAt = new Date(request.createdAt);
            
            // Get user data if populated
            const userProfile = request.userId ? {
                profilePicture: getUserProfilePicture(request.userId),
                fullName: request.userId.fullName || request.fullName || 'Unknown User'
            } : {
                profilePicture: '/images/default-profile.png',
                fullName: request.fullName || 'Unknown User'
            };

            return {
                ...request,
                id: request._id.toString(),
                documentType: Array.isArray(request.documentTypes) 
                    ? request.documentTypes.join(', ') 
                    : request.documentTypes || 'N/A',
                formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
                formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time',
                formattedScheduledDate: request.scheduledClaimDate ? 
                    format(new Date(request.scheduledClaimDate), 'MMM dd, yyyy') : 'Not scheduled',
                formattedScheduledTime: request.scheduledClaimTime || 'Not scheduled',
                userProfile: userProfile
            };
        });

        res.status(200).json(formattedRequests);
    } catch (error) {
        console.error("Error fetching user requests:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to fetch your requests. Please try again later."
        });
    }
});

// Approve request
router.put("/:id/approve", verifySession, checkNotBanned, async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Approved",
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId', 'fullName profilePicture');

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        const createdAt = new Date(request.createdAt);
        
        // Get user data if populated
        const userProfile = request.userId ? {
            profilePicture: getUserProfilePicture(request.userId),
            fullName: request.userId.fullName || request.fullName || 'Unknown User'
        } : {
            profilePicture: '/images/default-profile.png',
            fullName: request.fullName || 'Unknown User'
        };

        const formattedRequest = {
            ...request.toObject(),
            id: request._id.toString(),
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
            formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time',
            formattedScheduledDate: request.scheduledClaimDate ? 
                format(new Date(request.scheduledClaimDate), 'MMM dd, yyyy') : 'Not scheduled',
            formattedScheduledTime: request.scheduledClaimTime || 'Not scheduled',
            userProfile: userProfile
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        res.status(200).json({
            message: "Request approved successfully!",
            request: formattedRequest
        });
    } catch (error) {
        console.error("Error approving request:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to approve request. Please try again later."
        });
    }
});

// Reject request with reason
router.put("/:id/reject", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { rejectionReason } = req.body;

        if (!rejectionReason || rejectionReason.trim() === '') {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "Rejection reason is required" 
            });
        }

        const request = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Rejected",
                rejectionReason: rejectionReason.trim(),
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId', 'fullName profilePicture');

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        const createdAt = new Date(request.createdAt);
        
        // Get user data if populated
        const userProfile = request.userId ? {
            profilePicture: getUserProfilePicture(request.userId),
            fullName: request.userId.fullName || request.fullName || 'Unknown User'
        } : {
            profilePicture: '/images/default-profile.png',
            fullName: request.fullName || 'Unknown User'
        };

        const formattedRequest = {
            ...request.toObject(),
            id: request._id.toString(),
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
            formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time',
            formattedScheduledDate: request.scheduledClaimDate ? 
                format(new Date(request.scheduledClaimDate), 'MMM dd, yyyy') : 'Not scheduled',
            formattedScheduledTime: request.scheduledClaimTime || 'Not scheduled',
            userProfile: userProfile
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        res.status(200).json({
            message: "Request rejected successfully!",
            request: formattedRequest
        });
    } catch (error) {
        console.error("Error rejecting request:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to reject request. Please try again later."
        });
    }
});

// Mark request as ready to claim
router.put("/:id/ready", verifySession, checkNotBanned, async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Ready to Claim",
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId', 'fullName profilePicture');

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        const createdAt = new Date(request.createdAt);
        
        // Get user data if populated
        const userProfile = request.userId ? {
            profilePicture: getUserProfilePicture(request.userId),
            fullName: request.userId.fullName || request.fullName || 'Unknown User'
        } : {
            profilePicture: '/images/default-profile.png',
            fullName: request.fullName || 'Unknown User'
        };

        const formattedRequest = {
            ...request.toObject(),
            id: request._id.toString(),
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
            formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time',
            formattedScheduledDate: request.scheduledClaimDate ? 
                format(new Date(request.scheduledClaimDate), 'MMM dd, yyyy') : 'Not scheduled',
            formattedScheduledTime: request.scheduledClaimTime || 'Not scheduled',
            userProfile: userProfile
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        res.status(200).json({
            message: "Request marked as ready to claim!",
            request: formattedRequest
        });
    } catch (error) {
        console.error("Error updating request:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to update request status. Please try again later."
        });
    }
});

// UPDATED: Schedule pickup (sets status to "Scheduled for Pickup" instead of "Claimed")
router.put("/:id/schedule-pickup", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { scheduledClaimDate, scheduledClaimTime, pickupNotes } = req.body;
        const request = await Request.findById(req.params.id);

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found",
                success: false
            });
        }

        // FIXED: Proper user ID comparison
        if (request.userId.toString() !== req.session.userId.toString()) {
            console.log(`User ID mismatch: Request user ${request.userId}, Session user ${req.session.userId}`);
            return res.status(403).json({
                error: "Forbidden",
                message: "You can only schedule pickup for your own requests",
                success: false
            });
        }

        if (request.status !== 'Ready to Claim') {
            return res.status(400).json({
                error: "Bad Request",
                message: "Only requests with 'Ready to Claim' status can be scheduled for pickup",
                success: false
            });
        }

        // Validate scheduled claim date and time
        if (!scheduledClaimDate || !scheduledClaimTime) {
            return res.status(400).json({
                error: "Validation error",
                message: "Scheduled claim date and time are required",
                success: false
            });
        }

        // FIX: Add better validation logging
        console.log('Received schedule data:', { 
            scheduledClaimDate, 
            scheduledClaimTime, 
            pickupNotes,
            requestId: req.params.id,
            currentStatus: request.status
        });

        const validation = validateScheduledClaim(scheduledClaimDate, scheduledClaimTime);
        console.log('Validation result:', validation);
        
        if (!validation.valid) {
            return res.status(400).json({
                error: "Validation error",
                message: validation.message,
                success: false
            });
        }

        const updatedRequest = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Scheduled for Pickup",
                scheduledClaimDate: new Date(scheduledClaimDate),
                scheduledClaimTime: scheduledClaimTime,
                pickupNotes: pickupNotes || '',
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId', 'fullName profilePicture');

        const createdAt = new Date(updatedRequest.createdAt);
        
        // Get user data if populated
        const userProfile = updatedRequest.userId ? {
            profilePicture: getUserProfilePicture(updatedRequest.userId),
            fullName: updatedRequest.userId.fullName || updatedRequest.fullName || 'Unknown User'
        } : {
            profilePicture: '/images/default-profile.png',
            fullName: updatedRequest.fullName || 'Unknown User'
        };

        const formattedRequest = {
            ...updatedRequest.toObject(),
            id: updatedRequest._id.toString(),
            documentType: Array.isArray(updatedRequest.documentTypes) 
                ? updatedRequest.documentTypes.join(', ') 
                : updatedRequest.documentTypes || 'N/A',
            formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
            formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time',
            formattedScheduledDate: updatedRequest.scheduledClaimDate ? 
                format(new Date(updatedRequest.scheduledClaimDate), 'MMM dd, yyyy') : 'Not scheduled',
            formattedScheduledTime: updatedRequest.scheduledClaimTime || 'Not scheduled',
            userProfile: userProfile
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        res.status(200).json({
            message: `Pickup scheduled successfully! Scheduled for ${formattedRequest.formattedScheduledDate} at ${formattedRequest.formattedScheduledTime}`,
            request: formattedRequest,
            success: true
        });
    } catch (error) {
        console.error("Error scheduling pickup:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to schedule pickup. Please try again later.",
            success: false
        });
    }
});

// Admin marks request as claimed
router.put("/:id/claim", verifySession, checkNotBanned, async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Claimed",
                updatedAt: new Date()
            },
            { new: true }
        ).populate('userId', 'fullName profilePicture');

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        const createdAt = new Date(request.createdAt);
        
        // Get user data if populated
        const userProfile = request.userId ? {
            profilePicture: getUserProfilePicture(request.userId),
            fullName: request.userId.fullName || request.fullName || 'Unknown User'
        } : {
            profilePicture: '/images/default-profile.png',
            fullName: request.fullName || 'Unknown User'
        };

        const formattedRequest = {
            ...request.toObject(),
            id: request._id.toString(),
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
            formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time',
            formattedScheduledDate: request.scheduledClaimDate ? 
                format(new Date(request.scheduledClaimDate), 'MMM dd, yyyy') : 'Not scheduled',
            formattedScheduledTime: request.scheduledClaimTime || 'Not scheduled',
            userProfile: userProfile
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        res.status(200).json({
            message: "Request marked as claimed successfully!",
            request: formattedRequest
        });
    } catch (error) {
        console.error("Error marking request as claimed:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to mark request as claimed. Please try again later."
        });
    }
});

// FIXED: Clean up user's archived requests (only claimed documents for the logged-in user)
router.delete("/cleanup-archive", verifySession, checkNotBanned, async (req, res) => {
    try {
        console.log(`Cleaning up archive for user: ${req.session.userId}`);
        
        const result = await Request.deleteMany({
            userId: req.session.userId,
            status: "Claimed"
        });

        console.log(`Cleanup result: ${result.deletedCount} documents deleted`);

        req.app.get('io').emit('request-update', {
            type: 'deleted',
            count: result.deletedCount
        });

        res.status(200).json({
            message: `Successfully deleted ${result.deletedCount} claimed documents from your archive`,
            deletedCount: result.deletedCount,
            success: true
        });
    } catch (error) {
        console.error("Error cleaning up user archive:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to clean up archive. Please try again later.",
            success: false
        });
    }
});

// Delete rejected request
router.delete("/:id", verifySession, checkNotBanned, async (req, res) => {
    try {
        const request = await Request.findById(req.params.id);

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found",
                success: false
            });
        }

        if (request.userId.toString() !== req.session.userId.toString()) {
            return res.status(403).json({
                error: "Forbidden",
                message: "You can only delete your own requests",
                success: false
            });
        }

        if (request.status !== 'Rejected') {
            return res.status(400).json({
                error: "Bad Request",
                message: "Only rejected requests can be deleted",
                success: false
            });
        }

        await Request.findByIdAndDelete(req.params.id);

        req.app.get('io').emit('request-update', {
            type: 'deleted',
            requestId: req.params.id
        });

        res.status(200).json({
            message: "Request deleted successfully!",
            success: true
        });
    } catch (error) {
        console.error("Error deleting request:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to delete request. Please try again later.",
            success: false
        });
    }
});

// Clean up archived requests (admin only - all users)
router.post("/cleanup", verifySession, checkNotBanned, async (req, res) => {
    try {
        const result = await Request.deleteMany({
            status: { $in: ['Approved', 'Rejected', 'Claimed'] }
        });

        req.app.get('io').emit('request-update', {
            type: 'deleted',
            count: result.deletedCount
        });

        res.status(200).json({
            message: `Deleted ${result.deletedCount} archived requests`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error("Error cleaning up archived requests:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to clean up archived requests. Please try again later."
        });
    }
});

// Bulk actions for requests
router.post("/bulk-action", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { requestIds, action, rejectionReason } = req.body;

        if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "Request IDs are required" 
            });
        }

        if (!['approve', 'reject', 'ready', 'claim'].includes(action)) {
            return res.status(400).json({ 
                error: "Validation error", 
                message: "Invalid action" 
            });
        }

        let updateData = {};
        switch (action) {
            case 'approve':
                updateData.status = 'Approved';
                break;
            case 'reject':
                updateData.status = 'Rejected';
                if (rejectionReason) {
                    updateData.rejectionReason = rejectionReason;
                }
                break;
            case 'ready':
                updateData.status = 'Ready to Claim';
                break;
            case 'claim':
                updateData.status = 'Claimed';
                break;
        }

        updateData.updatedAt = new Date();

        const result = await Request.updateMany(
            { _id: { $in: requestIds } },
            updateData
        );

        // Emit updates for each request
        const updatedRequests = await Request.find({ _id: { $in: requestIds } })
            .populate('userId', 'fullName profilePicture')
            .lean();

        updatedRequests.forEach(request => {
            const createdAt = new Date(request.createdAt);
            const userProfile = request.userId ? {
                profilePicture: getUserProfilePicture(request.userId),
                fullName: request.userId.fullName || request.fullName || 'Unknown User'
            } : {
                profilePicture: '/images/default-profile.png',
                fullName: request.fullName || 'Unknown User'
            };

            const formattedRequest = {
                ...request,
                id: request._id.toString(),
                documentType: Array.isArray(request.documentTypes) 
                    ? request.documentTypes.join(', ') 
                    : request.documentTypes || 'N/A',
                formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
                formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time',
                formattedScheduledDate: request.scheduledClaimDate ? 
                    format(new Date(request.scheduledClaimDate), 'MMM dd, yyyy') : 'Not scheduled',
                formattedScheduledTime: request.scheduledClaimTime || 'Not scheduled',
                userProfile: userProfile
            };

            req.app.get('io').emit('request-update', {
                type: 'updated',
                request: formattedRequest
            });
        });

        res.status(200).json({
            message: `Successfully ${action}ed ${result.modifiedCount} request(s)`,
            processedCount: result.modifiedCount
        });
    } catch (error) {
        console.error("Error performing bulk action:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to perform bulk action. Please try again later."
        });
    }
});

module.exports = router;