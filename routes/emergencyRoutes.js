const express = require("express");
const EmergencyAlert = require("../models/EmergencyAlert");
const User = require("../models/User");
const router = express.Router();

// Resident sends emergency alert
router.post("/send", async (req, res) => {
    try {
        const { email, message } = req.body;
        
        const resident = await User.findOne({ email });
        if (!resident) {
            return res.status(404).json({ error: "Resident not found" });
        }

        const alert = new EmergencyAlert({
            residentId: resident._id,
            residentName: resident.fullName,
            message
        });

        await alert.save();
        
        // Emit socket event
        req.app.get('io').emit('newEmergencyAlert', alert);
        
        res.status(201).json(alert);
    } catch (error) {
        console.error("Error sending alert:", error);
        res.status(500).json({ error: "Failed to send emergency alert" });
    }
});

// Admin acknowledges alert
router.put("/:id/acknowledge", async (req, res) => {
    try {
        const alert = await EmergencyAlert.findByIdAndUpdate(
            req.params.id,
            { 
                status: 'acknowledged',
                acknowledgedAt: new Date() 
            },
            { new: true }
        );
        
        if (!alert) {
            return res.status(404).json({ error: "Alert not found" });
        }
        
        req.app.get('io').emit('alertAcknowledged', alert);
        res.json(alert);
    } catch (error) {
        res.status(500).json({ error: "Failed to acknowledge alert" });
    }
});

// Admin resolves alert
router.put("/:id/resolve", async (req, res) => {
    try {
        const alert = await EmergencyAlert.findByIdAndUpdate(
            req.params.id,
            { 
                status: 'resolved',
                resolvedAt: new Date() 
            },
            { new: true }
        );
        
        if (!alert) {
            return res.status(404).json({ error: "Alert not found" });
        }
        
        req.app.get('io').emit('alertResolved', alert);
        res.json(alert);
    } catch (error) {
        res.status(500).json({ error: "Failed to resolve alert" });
    }
});

// Get all alerts (for admin)
router.get("/", async (req, res) => {
    try {
        const { status } = req.query;
        const query = status ? { status } : {};
        const alerts = await EmergencyAlert.find(query).sort({ createdAt: -1 });
        res.json(alerts);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch alerts" });
    }
});

// Get alerts for specific resident
router.get("/resident/:residentId", async (req, res) => {
    try {
        const alerts = await EmergencyAlert.find({ 
            residentId: req.params.residentId 
        }).sort({ createdAt: -1 });
        
        res.json(alerts);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch alerts" });
    }
});

module.exports = router;