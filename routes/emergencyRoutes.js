const express = require("express");
const EmergencyAlert = require("../models/EmergencyAlert");
const User = require("../models/User");
const router = express.Router();

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
        
        req.app.get('io').emit('newEmergencyAlert', alert);
        
        res.status(201).json(alert);
    } catch (error) {
        console.error("Error sending alert:", error);
        res.status(500).json({ error: "Failed to send emergency alert" });
    }
});

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
        
        req.app.get('io').emit('alertResolved', alert._id);
        res.json(alert);
    } catch (error) {
        res.status(500).json({ error: "Failed to resolve alert" });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        const alert = await EmergencyAlert.findByIdAndDelete(req.params.id);
        
        if (!alert) {
            return res.status(404).json({ error: "Alert not found" });
        }
        
        req.app.get('io').emit('alertRemoved', alert._id);
        res.json({ message: "Alert deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete alert" });
    }
});

router.get("/", async (req, res) => {
    try {
        const { status } = req.query;
        const query = status ? { status } : { status: { $ne: 'resolved' } };
        const alerts = await EmergencyAlert.find(query).sort({ createdAt: -1 });
        res.json(alerts);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch alerts" });
    }
});

router.get("/resident/:residentId", async (req, res) => {
    try {
        const alerts = await EmergencyAlert.find({ 
            residentId: req.params.residentId,
            status: { $ne: 'resolved' }
        }).sort({ createdAt: -1 });
        
        res.json(alerts);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch alerts" });
    }
}); 

module.exports = router;