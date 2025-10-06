const mongoose = require("mongoose");

const emergencyAlertSchema = new mongoose.Schema({
    residentId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true 
    },
    residentName: { type: String, required: true },
    message: { type: String, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'acknowledged', 'resolved'],
        default: 'pending'
    },
    adminResponse: { type: String },
    createdAt: { type: Date, default: Date.now },
    acknowledgedAt: { type: Date },
    resolvedAt: { type: Date },
    emailSent: { type: Boolean, default: false },
    emailSentAt: { type: Date }
});

const EmergencyAlert = mongoose.model("EmergencyAlert", emergencyAlertSchema);

module.exports = EmergencyAlert;