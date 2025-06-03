const express = require("express");
const Request = require("../models/Request");
const { format, isValid } = require('date-fns');

const router = express.Router();

// Middleware to verify session
const verifySession = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
};

// Create a new document request
router.post("/", verifySession, async (req, res) => {
    try {
        const { fullName, address, documentType, purpose } = req.body;

        if (!fullName || !address || !documentType || !purpose) {
            return res.status(400).json({ error: "All fields are required" });
        }

        const newRequest = new Request({
            fullName,
            email: req.session.userEmail,
            address,
            documentType,
            purpose,
            status: "Pending"
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
        res.status(500).json({ error: "Server error" });
    }
});

// Get all requests (for admin)
router.get("/", verifySession, async (req, res) => {
    try {
        const { status, documentType, startDate, endDate, search } = req.query;
        let query = {};

        if (status) query.status = status;
        if (documentType) query.documentType = documentType;

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
            return {
                ...request,
                id: request._id,
                formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
                formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time'
            };
        });

        res.status(200).json(formattedRequests);
    } catch (error) {
        console.error("Error fetching requests:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Get requests for the logged-in user
router.get("/user", verifySession, async (req, res) => {
    try {
        const requests = await Request.find({ email: req.session.userEmail }).sort({ createdAt: -1 }).lean();

        const formattedRequests = requests.map(request => {
            const createdAt = new Date(request.createdAt);
            return {
                ...request,
                id: request._id,
                formattedDate: isValid(createdAt) ? format(createdAt, 'MMM dd, yyyy') : 'Invalid Date',
                formattedTime: isValid(createdAt) ? format(createdAt, 'hh:mm a') : 'Invalid Time'
            };
        });

        res.status(200).json(formattedRequests);
    } catch (error) {
        console.error("Error fetching user requests:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Approve a request
router.put("/:id/approve", verifySession, async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(req.params.id, { status: "Approved" }, { new: true });

        if (!request) {
            return res.status(404).json({ error: "Request not found" });
        }

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request
        });

        res.status(200).json({
            message: "Request approved successfully!",
            request
        });
    } catch (error) {
        console.error("Error approving request:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Reject a request
router.put("/:id/reject", verifySession, async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(req.params.id, { status: "Rejected" }, { new: true });

        if (!request) {
            return res.status(404).json({ error: "Request not found" });
        }

        req.app.get('io').emit('request-update', {
            type: 'updated',
            request
        });

        res.status(200).json({
            message: "Request rejected successfully!",
            request
        });
    } catch (error) {
        console.error("Error rejecting request:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Delete a request
router.delete("/:id", verifySession, async (req, res) => {
    try {
        const request = await Request.findByIdAndDelete(req.params.id);

        if (!request) {
            return res.status(404).json({ error: "Request not found" });
        }

        req.app.get('io').emit('request-update', {
            type: 'deleted',
            requestId: req.params.id
        });

        res.status(200).json({
            message: "Request deleted successfully!",
            requestId: req.params.id
        });
    } catch (error) {
        console.error("Error deleting request:", error);
        res.status(500).json({ error: "Server error" });
    }
});

module.exports = router;
