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
    
    // Email tracking
    emailSent: { type: Boolean, default: false },
    emailSentAt: { type: Date },
    
    // Enhanced SMS tracking
    smsSent: { type: Boolean, default: false },
    smsSentAt: { type: Date },
    smsGatewayUsed: { type: String }, // Which carrier gateway worked
    smsAttempts: { type: Number, default: 0 }, // Fixed: Added default value 0
    
    // Telegram tracking
    telegramSent: { type: Boolean, default: false },
    telegramSentAt: { type: Date },
    telegramMessageId: { type: String }, // Telegram message ID for tracking
    
    // Notification tracking
    pushNotificationsSent: { type: Boolean, default: false },
    pushNotificationsSentAt: { type: Date }
});

// Index for better query performance
emergencyAlertSchema.index({ residentId: 1, createdAt: -1 });
emergencyAlertSchema.index({ status: 1 });
emergencyAlertSchema.index({ createdAt: -1 });
emergencyAlertSchema.index({ emailSent: 1 });
emergencyAlertSchema.index({ smsSent: 1 });
emergencyAlertSchema.index({ telegramSent: 1 });
emergencyAlertSchema.index({ smsGatewayUsed: 1 });

const EmergencyAlert = mongoose.model("EmergencyAlert", emergencyAlertSchema);

module.exports = EmergencyAlert;