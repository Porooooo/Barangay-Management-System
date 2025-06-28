const express = require("express");
const Request = require("../models/Request");
const User = require("../models/User");
const { format, isValid, subMonths } = require('date-fns');

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

// Create a new document request
router.post("/", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { fullName, address, documentTypes, purpose } = req.body;

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

        const createdAt = new Date(newRequest.createdAt);
        const formattedRequest = {
            ...newRequest._doc,
            formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
            formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time'
        };

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

// Get all requests (for admin)
router.get("/", verifySession, checkNotBanned, async (req, res) => {
    try {
        const { status, documentType, startDate, endDate, search, archive } = req.query;
        let query = {};

        if (archive === 'true') {
            query = {
                status: { $in: ['Approved', 'Rejected', 'Claimed'] }
            };
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

        const requests = await Request.find(query).sort({ createdAt: -1 }).lean();

        const formattedRequests = requests.map(request => {
            const createdAt = new Date(request.createdAt);
            const updatedAt = new Date(request.updatedAt);
            return {
                ...request,
                id: request._id,
                documentType: Array.isArray(request.documentTypes) 
                    ? request.documentTypes.join(', ') 
                    : request.documentTypes || 'N/A',
                formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
                formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time',
                updatedAt: isValid(updatedAt) ? updatedAt : new Date()
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

// Get requests for the logged-in user
router.get("/user", verifySession, checkNotBanned, async (req, res) => {
    try {
        const requests = await Request.find({ 
            userId: req.session.userId 
        }).sort({ createdAt: -1 }).lean();

        const formattedRequests = requests.map(request => {
            const createdAt = new Date(request.createdAt);
            return {
                ...request,
                id: request._id,
                documentType: Array.isArray(request.documentTypes) 
                    ? request.documentTypes.join(', ') 
                    : request.documentTypes || 'N/A',
                formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
                formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time'
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

// Approve a request
router.put("/:id/approve", verifySession, checkNotBanned, async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Approved",
                updatedAt: new Date()
            },
            { new: true }
        );

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        const formattedRequest = {
            ...request._doc,
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: format(new Date(request.createdAt), 'MMM dd, yyyy'),
            formattedTime: format(new Date(request.createdAt), 'hh:mm a')
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

// Reject a request
router.put("/:id/reject", verifySession, checkNotBanned, async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(
            req.params.id,
            {
                status: "Rejected",
                updatedAt: new Date()
            },
            { new: true }
        );

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        const formattedRequest = {
            ...request._doc,
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: format(new Date(request.createdAt), 'MMM dd, yyyy'),
            formattedTime: format(new Date(request.createdAt), 'hh:mm a')
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
        );

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        const formattedRequest = {
            ...request._doc,
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: format(new Date(request.createdAt), 'MMM dd, yyyy'),
            formattedTime: format(new Date(request.createdAt), 'hh:mm a')
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
        );

        if (!request) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Request not found" 
            });
        }

        const formattedRequest = {
            ...request._doc,
            documentType: Array.isArray(request.documentTypes) 
                ? request.documentTypes.join(', ') 
                : request.documentTypes || 'N/A',
            formattedDate: format(new Date(request.createdAt), 'MMM dd, yyyy'),
            formattedTime: format(new Date(request.createdAt), 'hh:mm a')
        };

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request: formattedRequest
        });

        res.status(200).json({
            message: "Request marked as claimed!",
            request: formattedRequest
        });
    } catch (error) {
        console.error("Error updating request:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to mark request as claimed. Please try again later."
        });
    }
});

// Clean up old requests
router.post("/cleanup", verifySession, checkNotBanned, async (req, res) => {
    try {
        const oneMonthAgo = subMonths(new Date(), 1);

        const result = await Request.deleteMany({
            status: { $in: ['Approved', 'Rejected', 'Claimed'] },
            updatedAt: { $lt: oneMonthAgo }
        });

        req.app.get('io').emit('request-update', {
            type: 'deleted',
            count: result.deletedCount
        });

        res.status(200).json({
            message: `Deleted ${result.deletedCount} old requests`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error("Error cleaning up old requests:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to clean up old requests. Please try again later."
        });
    }
});

module.exports = router;