const express = require("express");
const Request = require("../models/Request");
const { format, parseISO } = require('date-fns');

const router = express.Router();

// Create a new document request
router.post("/", async (req, res) => {
    try {
        const { fullName, email, address, documentType, purpose } = req.body;
        
        if (!fullName || !email || !address || !documentType || !purpose) {
            return res.status(400).json({ error: "❌ All fields are required" });
        }

        const newRequest = new Request({
            fullName,
            email,
            address,
            documentType,
            purpose,
            status: "Pending"
        });

        await newRequest.save();
        
        // Notify all clients
        req.app.get('io').emit('request-update', {
            type: 'created',
            request: newRequest
        });

        res.status(201).json({
            message: "✅ Request submitted successfully!",
            request: newRequest
        });
    } catch (error) {
        console.error("Error submitting request:", error);
        res.status(500).json({ 
            error: "❌ Server error",
            details: error.message 
        });
    }
});

// Get all requests with filters
router.get("/", async (req, res) => {
    try {
        const { status, documentType, startDate, endDate, search } = req.query;
        let query = {};

        // Status filter
        if (status) {
            query.status = status;
        }

        // Document type filter
        if (documentType) {
            query.documentType = documentType;
        }

        // Date range filter
        if (startDate && endDate) {
            query.createdAt = {
                $gte: new Date(startDate),
                $lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
            };
        }

        // Search filter
        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { address: { $regex: search, $options: 'i' } }
            ];
        }

        const requests = await Request.find(query)
            .sort({ createdAt: -1 });

        // Format dates
        const formattedRequests = requests.map(request => ({
            ...request._doc,
            formattedDate: format(request.createdAt, 'MMM dd, yyyy'),
            formattedTime: format(request.createdAt, 'hh:mm a')
        }));

        res.status(200).json(formattedRequests);
    } catch (error) {
        console.error("Error fetching requests:", error);
        res.status(500).json({ 
            error: "❌ Server error",
            details: error.message 
        });
    }
});

// Get requests for a specific user
router.get("/user", async (req, res) => {
    try {
        const { email } = req.query;
        
        if (!email) {
            return res.status(400).json({ error: "❌ Email parameter is required" });
        }

        const requests = await Request.find({ email })
            .sort({ createdAt: -1 });

        res.status(200).json(requests);
    } catch (error) {
        console.error("Error fetching user requests:", error);
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Approve a request
router.put("/:id/approve", async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(
            req.params.id,
            { status: "Approved" },
            { new: true }
        );

        if (!request) {
            return res.status(404).json({ error: "❌ Request not found" });
        }

        // Notify all clients
        req.app.get('io').emit('request-update', {
            type: 'updated',
            request
        });

        res.status(200).json({
            message: "✅ Request approved successfully!",
            request
        });
    } catch (error) {
        console.error("Error approving request:", error);
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Reject a request
router.put("/:id/reject", async (req, res) => {
    try {
        const request = await Request.findByIdAndUpdate(
            req.params.id,
            { status: "Rejected" },
            { new: true }
        );

        if (!request) {
            return res.status(404).json({ error: "❌ Request not found" });
        }

        // Notify all clients
        req.app.get('io').emit('request-update', {
            type: 'updated',
            request
        });

        res.status(200).json({
            message: "✅ Request rejected successfully!",
            request
        });
    } catch (error) {
        console.error("Error rejecting request:", error);
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Delete a request
router.delete("/:id", async (req, res) => {
    try {
        const request = await Request.findByIdAndDelete(req.params.id);

        if (!request) {
            return res.status(404).json({ error: "❌ Request not found" });
        }

        // Notify all clients
        req.app.get('io').emit('request-update', {
            type: 'deleted',
            requestId: req.params.id
        });

        res.status(200).json({
            message: "✅ Request deleted successfully!",
            requestId: req.params.id
        });
    } catch (error) {
        console.error("Error deleting request:", error);
        res.status(500).json({ error: "❌ Server error" });
    }
});

module.exports = router;