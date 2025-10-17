const express = require("express");
const mongoose = require("mongoose");
const Blotter = require("../models/Blotter");
const User = require("../models/User");

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

// ✅ Create a new blotter report
router.post("/", verifySession, async (req, res) => {
    try {
        const {
            incidentDate,
            location,
            complaintType,
            complaintDetails,
            accused
        } = req.body;

        const newBlotter = new Blotter({
            complainant: req.session.userId,
            incidentDate,
            location,
            complaintType,
            complaintDetails,
            accused,
            status: "Pending"
        });

        await newBlotter.save();
        
        // Format the response
        const formattedBlotter = {
            ...newBlotter.toObject(),
            id: newBlotter._id.toString(),
            formattedIncidentDate: new Date(newBlotter.incidentDate).toLocaleDateString(),
            formattedReportedDate: new Date(newBlotter.dateReported).toLocaleDateString()
        };

        res.status(201).json({
            message: "Blotter report submitted successfully!",
            blotter: formattedBlotter
        });
    } catch (error) {
        console.error("❌ Error creating blotter:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to submit blotter report. Please try again later."
        });
    }
});

// ✅ Get blotter entries for the current user (UPDATED with archive support)
router.get("/user", verifySession, async (req, res) => {
    try {
        const { archive } = req.query;
        let query = { complainant: req.session.userId };

        // If archive=true, show only resolved cases
        // If archive=false or not provided, show active cases (excluding resolved)
        if (archive === 'true') {
            query.status = { $in: ["Resolved", "Dismissed", "Escalated to PNP"] };
        } else {
            query.status = { $nin: ["Resolved", "Dismissed", "Escalated to PNP"] };
        }

        const blotterEntries = await Blotter.find(query)
            .populate('complainant', 'fullName')
            .sort({ dateReported: -1 });

        // Format the response
        const formattedEntries = blotterEntries.map(entry => ({
            ...entry.toObject(),
            id: entry._id.toString(),
            formattedIncidentDate: new Date(entry.incidentDate).toLocaleDateString(),
            formattedReportedDate: new Date(entry.dateReported).toLocaleDateString(),
            formattedResolvedDate: entry.resolvedDate ? new Date(entry.resolvedDate).toLocaleDateString() : null
        }));

        res.status(200).json(formattedEntries);
    } catch (error) {
        console.error("Error fetching user blotter entries:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to fetch blotter reports. Please try again later."
        });
    }
});

// ✅ Get all blotter entries
router.get("/", verifySession, async (req, res) => {
    try {
        const blotterEntries = await Blotter.find()
            .populate('complainant', 'fullName')
            .sort({ dateReported: -1 });

        res.status(200).json(blotterEntries);
    } catch (error) {
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to fetch blotter reports."
        });
    }
});

// ✅ Get a specific blotter entry
router.get("/:id", verifySession, async (req, res) => {
    try {
        const id = req.params.id;
        const blotterEntry = await Blotter.findById(id)
            .populate('complainant', 'fullName');

        if (!blotterEntry) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Blotter entry not found" 
            });
        }

        res.status(200).json(blotterEntry);
    } catch (error) {
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to fetch blotter entry."
        });
    }
});

// ✅ Record a call attempt
router.post("/:id/call", verifySession, async (req, res) => {
    try {
        const id = req.params.id;
        const { successful, notes } = req.body;

        const blotter = await Blotter.findById(id);
        if (!blotter) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Blotter not found" 
            });
        }

        // Add to call history
        blotter.callHistory.push({
            date: new Date(),
            successful,
            notes
        });

        // Update call attempts if failed
        if (!successful) {
            blotter.callAttempts = (blotter.callAttempts || 0) + 1;
        } else {
            blotter.callAttempts = 0;
        }

        await blotter.save();
        res.status(200).json(blotter);
    } catch (error) {
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to record call attempt."
        });
    }
});

// ✅ Escalate case to PNP
router.post("/:id/escalate", verifySession, async (req, res) => {
    try {
        const id = req.params.id;
        const { resolutionDetails } = req.body;

        const blotter = await Blotter.findById(id);
        if (!blotter) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Blotter not found" 
            });
        }

        blotter.status = "Escalated to PNP";
        blotter.resolutionDetails = resolutionDetails;
        blotter.resolvedDate = new Date();

        await blotter.save();
        res.status(200).json(blotter);
    } catch (error) {
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to escalate case."
        });
    }
});

// ✅ Update blotter status
router.put("/:id/status", verifySession, async (req, res) => {
    try {
        const id = req.params.id;
        const { status, resolutionDetails } = req.body;

        const blotter = await Blotter.findById(id);
        if (!blotter) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Blotter not found" 
            });
        }

        blotter.status = status;
        blotter.resolutionDetails = resolutionDetails;

        if (status === "Resolved" || status === "Dismissed") {
            blotter.resolvedDate = new Date();
        }

        await blotter.save();
        res.status(200).json(blotter);
    } catch (error) {
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to update blotter status."
        });
    }
});

// ✅ Update blotter details
router.put("/:id", verifySession, async (req, res) => {
    try {
        const id = req.params.id;
        const { status, accusedContact, resolutionDetails } = req.body;

        const blotter = await Blotter.findById(id);
        if (!blotter) {
            return res.status(404).json({ 
                error: "Not found", 
                message: "Blotter not found" 
            });
        }

        if (status) blotter.status = status;
        if (accusedContact) blotter.accused.contact = accusedContact;
        if (resolutionDetails) blotter.resolutionDetails = resolutionDetails;

        await blotter.save();
        res.status(200).json(blotter);
    } catch (error) {
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to update blotter details."
        });
    }
});

// ✅ NEW: Clean up user's archived blotter reports (only resolved cases for the logged-in user)
router.delete("/cleanup-archive", verifySession, async (req, res) => {
    try {
        console.log(`Cleaning up blotter archive for user: ${req.session.userId}`);
        
        const result = await Blotter.deleteMany({
            complainant: req.session.userId,
            status: { $in: ["Resolved", "Dismissed"] }
        });

        console.log(`Blotter cleanup result: ${result.deletedCount} reports deleted`);

        // Emit real-time update if you have socket.io setup
        if (req.app.get('io')) {
            req.app.get('io').emit('blotter-update', {
                type: 'deleted',
                count: result.deletedCount
            });
        }

        res.status(200).json({
            message: `Successfully deleted ${result.deletedCount} resolved blotter cases from your archive`,
            deletedCount: result.deletedCount,
            success: true
        });
    } catch (error) {
        console.error("Error cleaning up user blotter archive:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to clean up archive. Please try again later.",
            success: false
        });
    }
});

// ✅ Delete a single blotter report
router.delete("/:id", verifySession, async (req, res) => {
    try {
        const id = req.params.id;
        
        // First verify the blotter exists and belongs to the user
        const blotter = await Blotter.findById(id);
        if (!blotter) {
            return res.status(404).json({ 
                error: "Not found",
                message: "Blotter report not found",
                success: false
            });
        }

        // Check if the user owns this blotter report
        if (blotter.complainant.toString() !== req.session.userId.toString()) {
            return res.status(403).json({
                error: "Forbidden",
                message: "You can only delete your own blotter reports",
                success: false
            });
        }

        // Only allow deletion of pending or investigating reports
        if (!["Pending", "Under Investigation"].includes(blotter.status)) {
            return res.status(400).json({ 
                error: "Bad Request",
                message: "Only pending or under investigation reports can be deleted",
                success: false
            });
        }

        await Blotter.findByIdAndDelete(id);

        // Emit real-time update if you have socket.io setup
        if (req.app.get('io')) {
            req.app.get('io').emit('blotter-update', {
                type: 'deleted',
                blotterId: id
            });
        }

        res.status(200).json({ 
            message: "Blotter report deleted successfully",
            success: true
        });
    } catch (error) {
        console.error("Error deleting blotter:", error);
        res.status(500).json({ 
            error: "Server error",
            message: "Failed to delete blotter report. Please try again later.",
            success: false
        });
    }
});

module.exports = router;