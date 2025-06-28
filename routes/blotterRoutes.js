const express = require("express");
const mongoose = require("mongoose");
const Blotter = require("../models/Blotter");
const User = require("../models/User");

const router = express.Router();

// ✅ Create a new blotter report
router.post("/", async (req, res) => {
    try {
        const {
            incidentDate,
            location,
            complaintType,
            complaintDetails,
            accused
        } = req.body;

        if (!req.session.userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

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
        res.status(201).json(newBlotter);
    } catch (error) {
        console.error("❌ Error creating blotter:", error);
        res.status(500).json({ error: "❌ Server error" });
    }
});

// ✅ Get blotter entries for the current user
router.get("/user", async (req, res) => {
    try {
        if (!req.session.userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const blotterEntries = await Blotter.find({ complainant: req.session.userId })
            .sort({ dateReported: -1 });

        res.status(200).json(blotterEntries);
    } catch (error) {
        console.error("Error fetching user blotter entries:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// ✅ Get all blotter entries
router.get("/", async (req, res) => {
    try {
        const blotterEntries = await Blotter.find()
            .populate('complainant', 'fullName')
            .sort({ dateReported: -1 });

        res.status(200).json(blotterEntries);
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// ✅ Get a specific blotter entry
router.get("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const blotterEntry = await Blotter.findById(id)
            .populate('complainant', 'fullName');

        if (!blotterEntry) {
            return res.status(404).json({ error: "❌ Blotter entry not found" });
        }

        res.status(200).json(blotterEntry);
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// ✅ Record a call attempt
router.post("/:id/call", async (req, res) => {
    try {
        const id = req.params.id;
        const { successful, notes } = req.body;

        const blotter = await Blotter.findById(id);
        if (!blotter) {
            return res.status(404).json({ error: "Blotter not found" });
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
        res.status(500).json({ error: "Server error" });
    }
});

// ✅ Escalate case to PNP
router.post("/:id/escalate", async (req, res) => {
    try {
        const id = req.params.id;
        const { resolutionDetails } = req.body;

        const blotter = await Blotter.findById(id);
        if (!blotter) {
            return res.status(404).json({ error: "Blotter not found" });
        }

        blotter.status = "Escalated to PNP";
        blotter.resolutionDetails = resolutionDetails;
        blotter.resolvedDate = new Date();

        await blotter.save();
        res.status(200).json(blotter);
    } catch (error) {
        res.status(500).json({ error: "Server error" });
    }
});

// ✅ Update blotter status
router.put("/:id/status", async (req, res) => {
    try {
        const id = req.params.id;
        const { status, resolutionDetails } = req.body;

        const blotter = await Blotter.findById(id);
        if (!blotter) {
            return res.status(404).json({ error: "Blotter not found" });
        }

        blotter.status = status;
        blotter.resolutionDetails = resolutionDetails;

        if (status === "Resolved" || status === "Dismissed") {
            blotter.resolvedDate = new Date();
        }

        await blotter.save();
        res.status(200).json(blotter);
    } catch (error) {
        res.status(500).json({ error: "Server error" });
    }
});

// ✅ Update blotter details
router.put("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const { status, accusedContact, resolutionDetails } = req.body;

        const blotter = await Blotter.findById(id);
        if (!blotter) {
            return res.status(404).json({ error: "Blotter not found" });
        }

        if (status) blotter.status = status;
        if (accusedContact) blotter.accused.contact = accusedContact;
        if (resolutionDetails) blotter.resolutionDetails = resolutionDetails;

        await blotter.save();
        res.status(200).json(blotter);
    } catch (error) {
        res.status(500).json({ error: "Server error" });
    }
});

module.exports = router;