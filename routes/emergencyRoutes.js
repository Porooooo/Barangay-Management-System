const express = require("express");
const EmergencyAlert = require("../models/EmergencyAlert");
const User = require("../models/User");
const router = express.Router();

// Function to send emergency email to admin - UPDATED: Use transporter from app
async function sendEmergencyEmailToAdmin(req, alert) {
    try {
        const emailTransporter = req.app.get('emailTransporter');
        
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'barangaytalipapa7@gmail.com',
            to: process.env.EMERGENCY_EMAIL_RECIPIENT || 'barangaytalipapa7@gmail.com',
            subject: `URGENT: Unacknowledged Emergency Alert - ${alert.residentName}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #e74c3c; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">
                        🚨 EMERGENCY ALERT REQUIRES ATTENTION
                    </h2>
                    
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3 style="color: #2c3e50; margin-top: 0;">Alert Details:</h3>
                        <p><strong>Resident Name:</strong> ${alert.residentName}</p>
                        <p><strong>Emergency Message:</strong> ${alert.message}</p>
                        <p><strong>Time Received:</strong> ${new Date(alert.createdAt).toLocaleString()}</p>
                        <p><strong>Time Elapsed:</strong> More than 1 minute without response</p>
                    </div>
                    
                    <div style="background-color: #fff3cd; padding: 15px; border-radius: 6px; border-left: 4px solid #ffc107;">
                        <p style="margin: 0; color: #856404;">
                            <strong>⚠️ Action Required:</strong> This emergency alert has been pending for over 1 minute without acknowledgment. 
                            Please log in to the admin dashboard immediately to respond.
                        </p>
                    </div>
                    
                    <div style="margin-top: 20px; padding: 15px; background-color: #e8f4fd; border-radius: 6px;">
                        <p style="margin: 0; color: #0c5460;">
                            <strong>Quick Actions:</strong><br>
                            1. Log in to Admin Dashboard<br>
                            2. Navigate to Emergency Alerts section<br>
                            3. Respond to this emergency immediately
                        </p>
                    </div>
                    
                    <footer style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #6c757d;">
                        <p>This is an automated message from Barangay Talipapa Emergency Alert System.</p>
                        <p>Please do not reply to this email.</p>
                    </footer>
                </div>
            `
        };

        await emailTransporter.sendMail(mailOptions);
        
        // Update alert to mark email as sent
        await EmergencyAlert.findByIdAndUpdate(alert._id, {
            emailSent: true,
            emailSentAt: new Date()
        });
        
        console.log(`Emergency email sent to admin for alert: ${alert._id}`);
        return true;
    } catch (error) {
        console.error('Error sending emergency email:', error);
        return false;
    }
}

// Function to check for unacknowledged alerts and send emails
async function checkUnacknowledgedAlerts(req) {
    try {
        const oneMinuteAgo = new Date(Date.now() - 60000); // 1 minute ago
        
        const unacknowledgedAlerts = await EmergencyAlert.find({
            status: 'pending',
            createdAt: { $lte: oneMinuteAgo },
            emailSent: false
        });
        
        for (const alert of unacknowledgedAlerts) {
            console.log(`Sending email for unacknowledged alert: ${alert._id}`);
            await sendEmergencyEmailToAdmin(req, alert);
        }
    } catch (error) {
        console.error('Error checking unacknowledged alerts:', error);
    }
}

// Run check every 30 seconds
setInterval(() => {
    // We'll call this from routes that have access to req
}, 30000);

// Stats endpoint
router.get("/stats", async (req, res) => {
    try {
        const pending = await EmergencyAlert.countDocuments({ status: 'pending' });
        const acknowledged = await EmergencyAlert.countDocuments({ status: 'acknowledged' });
        const resolved = await EmergencyAlert.countDocuments({ status: 'resolved' });
        
        res.json({
            success: true,
            data: {
                pending: pending || 0,
                acknowledged: acknowledged || 0,
                resolved: resolved || 0,
                total: (pending || 0) + (acknowledged || 0) + (resolved || 0)
            }
        });
    } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to fetch emergency alert statistics" 
        });
    }
});

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
        
        // Schedule email check for this alert after 1 minute
        setTimeout(async () => {
            const updatedAlert = await EmergencyAlert.findById(alert._id);
            if (updatedAlert && updatedAlert.status === 'pending' && !updatedAlert.emailSent) {
                console.log(`Alert ${alert._id} still unacknowledged after 1 minute, sending email...`);
                await sendEmergencyEmailToAdmin(req, updatedAlert);
            }
        }, 61000); // 61 seconds to ensure 1 minute has passed
        
        res.status(201).json(alert);
    } catch (error) {
        console.error("Error sending alert:", error);
        res.status(500).json({ error: "Failed to send emergency alert" });
    }
});

// Keep both endpoints for compatibility
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

// Cleanup endpoint to delete all resolved alerts
router.delete("/cleanup", async (req, res) => {
    try {
        const result = await EmergencyAlert.deleteMany({ status: 'resolved' });
        
        res.json({
            success: true,
            message: `Successfully cleared ${result.deletedCount} resolved alerts`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error("Error clearing resolved alerts:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to clear resolved alerts" 
        });
    }
});

router.get("/", async (req, res) => {
    try {
        const { status } = req.query;
        let query = {};
        
        if (status === 'active') {
            query = { status: { $in: ['pending', 'acknowledged'] } };
        } else if (status && status !== 'all') {
            query = { status };
        }
        
        const alerts = await EmergencyAlert.find(query)
            .sort({ createdAt: -1 })
            .populate('residentId', 'contactNumber address');
            
        res.json({
            success: true,
            alerts: alerts.map(alert => ({
                _id: alert._id,
                residentName: alert.residentName || 'Unknown Resident',
                message: alert.message || '',
                status: alert.status || 'pending',
                adminResponse: alert.adminResponse,
                createdAt: alert.createdAt,
                acknowledgedAt: alert.acknowledgedAt,
                resolvedAt: alert.resolvedAt,
                emailSent: alert.emailSent,
                emailSentAt: alert.emailSentAt,
                contactNumber: alert.residentId?.contactNumber || 'N/A',
                address: alert.residentId?.address || 'N/A'
            }))
        });
    } catch (error) {
        console.error("Error fetching alerts:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to fetch alerts" 
        });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const alert = await EmergencyAlert.findById(req.params.id)
            .populate('residentId', 'contactNumber address');
            
        if (!alert) {
            return res.status(404).json({ 
                success: false,
                error: "Alert not found" 
            });
        }
        
        res.json({
            success: true,
            alert: {
                _id: alert._id,
                residentName: alert.residentName || 'Unknown Resident',
                message: alert.message || '',
                status: alert.status || 'pending',
                adminResponse: alert.adminResponse,
                createdAt: alert.createdAt,
                acknowledgedAt: alert.acknowledgedAt,
                resolvedAt: alert.resolvedAt,
                emailSent: alert.emailSent,
                emailSentAt: alert.emailSentAt,
                contactNumber: alert.residentId?.contactNumber || 'N/A',
                address: alert.residentId?.address || 'N/A'
            }
        });
    } catch (error) {
        console.error("Error fetching alert:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to fetch alert" 
        });
    }
});

// Updated respond endpoint to match frontend
router.post("/:id/respond", async (req, res) => {
    try {
        const { id } = req.params;
        const { adminMessage } = req.body;
        
        const alert = await EmergencyAlert.findById(id);
        if (!alert) {
            return res.status(404).json({ 
                success: false,
                error: "Alert not found" 
            });
        }

        const updatedAlert = await EmergencyAlert.findByIdAndUpdate(
            id,
            { 
                status: 'acknowledged',
                acknowledgedAt: new Date(),
                adminResponse: adminMessage 
            },
            { new: true }
        ).populate('residentId', 'contactNumber address');
        
        req.app.get('io').emit('alertAcknowledged', {
            _id: updatedAlert._id,
            residentName: updatedAlert.residentName,
            message: updatedAlert.message,
            status: updatedAlert.status,
            adminResponse: updatedAlert.adminResponse,
            createdAt: updatedAlert.createdAt,
            acknowledgedAt: updatedAlert.acknowledgedAt,
            contactNumber: updatedAlert.residentId?.contactNumber,
            address: updatedAlert.residentId?.address
        });
        
        res.json({
            success: true,
            alert: updatedAlert
        });
    } catch (error) {
        console.error("Error responding to alert:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to respond to alert" 
        });
    }
});

// Background check for unacknowledged alerts
setInterval(async () => {
    try {
        const oneMinuteAgo = new Date(Date.now() - 60000);
        const unacknowledgedAlerts = await EmergencyAlert.find({
            status: 'pending',
            createdAt: { $lte: oneMinuteAgo },
            emailSent: false
        });
        
        // We can't send emails here without req, but we can log them
        if (unacknowledgedAlerts.length > 0) {
            console.log(`Found ${unacknowledgedAlerts.length} unacknowledged alerts older than 1 minute`);
        }
    } catch (error) {
        console.error('Error in background alert check:', error);
    }
}, 30000);

module.exports = router;