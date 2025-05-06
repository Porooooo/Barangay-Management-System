const express = require("express");
const Request = require("../models/Request");

const router = express.Router();

// Create a new document request
router.post("/", async (req, res) => {
    try {
        const newRequest = new Request(req.body);
        await newRequest.save();
        res.status(201).json({ message: "✅ Request submitted successfully!" });
    } catch (error) {
        res.status(400).json({ error: "❌ Error submitting request" });
    }
});

// Get all document requests (for admin view)
router.get("/", async (req, res) => {
    try {
        const requests = await Request.find();
        res.status(200).json(requests);
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Create a new document request
router.post("/", async (req, res) => {
    try {
        const { fullName, email, address, documentType, purpose } = req.body;
        const newRequest = new Request({ fullName, email, address, documentType, purpose });
        await newRequest.save();
        res.status(201).json({ message: "✅ Document request submitted successfully!" });
    } catch (error) {
        console.error("Error submitting request:", error);
        res.status(400).json({ error: error.message || "❌ Error submitting request" });
    }
});

// Get document requests for a specific resident
router.get("/resident", async (req, res) => {
    try {
        const { email } = req.query; // Get the resident's email from query params
        const requests = await Request.find({ email }); // Fetch requests for the resident
        res.status(200).json(requests);
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Approve a document request
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
        res.status(200).json({ message: "✅ Request approved successfully!" });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Reject a document request
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
        res.status(200).json({ message: "✅ Request rejected successfully!" });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Delete a request after approval/rejection
router.delete("/:requestId", async (req, res) => {
    try {
        const request = await Request.findByIdAndDelete(req.params.requestId);
        if (!request) {
            return res.status(404).json({ error: "❌ Request not found" });
        }
        res.status(200).json({ message: "✅ Request deleted successfully!" });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

module.exports = router;