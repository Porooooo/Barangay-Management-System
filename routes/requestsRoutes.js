const express = require("express");
const Request = require("../models/Request");
const User = require("../models/User");
const { format, isValid } = require('date-fns');

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
            query.status = status || { $in: ['Pending', 'Approved', 'Ready to Claim'] };
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

// Get requests for logged-in user
router.get("/user", verifySession, checkNotBanned, async (req, res) => {
    try {
        const requests = await Request.find({ 
            userId: req.session.userId,
            status: { $ne: "Claimed" }
        })
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

// Mark request as claimed
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
                message: "Request not found",
                success: false
            });
        }

        if (request.userId.toString() !== req.session.userId) {
            return res.status(403).json({
                error: "Forbidden",
                message: "You can only claim your own requests",
                success: false
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
            userProfile: userProfile
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        res.status(200).json({
            message: "Request marked as claimed!",
            request: formattedRequest,
            success: true
        });
    } catch (error) {
        console.error("Error updating request:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to mark request as claimed. Please try again later.",
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

        if (request.userId.toString() !== req.session.userId) {
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

// Clean up archived requests
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

        if (!['approve', 'reject', 'ready'].includes(action)) {
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