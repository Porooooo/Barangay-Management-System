const mongoose = require("mongoose");
const { isAfter, isBefore, addDays, startOfDay, endOfDay } = require('date-fns');

const requestSchema = new mongoose.Schema({
    fullName: { 
        type: String, 
        required: [true, "Full name is required"],
        trim: true
    },
    email: { 
        type: String, 
        required: [true, "Email is required"],
        trim: true,
        lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
    },
    address: { 
        type: String, 
        required: [true, "Address is required"],
        trim: true
    },
    documentTypes: { 
        type: [String], 
        required: [true, "At least one document type is required"],
        validate: {
            validator: function(arr) {
                return arr.length > 0;
            },
            message: "At least one document type must be selected"
        }
    },
    purpose: { 
        type: String, 
        required: [true, "Purpose is required"],
        trim: true
    },
    status: { 
        type: String, 
        default: "Pending",
        enum: {
            values: ['Pending', 'Approved', 'Processing', 'Ready to Claim', 'Scheduled for Pickup', 'Claimed', 'Archived', 'Expired'],
            message: 'Invalid status'
        },
        index: true
    },
    rejectionReason: {
        type: String,
        trim: true
    },
    // NEW: Admin-set pickup time period
    adminPickupPeriod: {
        startDate: {
            type: Date,
            default: null
        },
        endDate: {
            type: Date,
            default: null
        },
        availableTimeSlots: [{
            date: Date,
            time: String, // Format: "HH:MM"
            isAvailable: {
                type: Boolean,
                default: true
            }
        }],
        notes: {
            type: String,
            default: ''
        }
    },
    // Resident-chosen slot
    scheduledClaimDate: {
        type: Date,
        default: null
    },
    scheduledClaimTime: {
        type: String,
        default: null
    },
    pickupNotes: {
        type: String,
        default: ''
    },
    // NEW: Expiration tracking
    expirationDate: {
        type: Date,
        default: null
    },
    isExpired: {
        type: Boolean,
        default: false
    },
    // Automated timeline fields
    priorityScore: {
        type: Number,
        default: 0
    },
    estimatedCompletionDate: {
        type: Date,
        default: null
    },
    autoArchiveDate: {
        type: Date,
        default: null
    },
    processingStage: {
        type: String,
        default: "Submitted",
        enum: ['Submitted', 'Processing', 'Ready']
    },
    // Automation tracking
    lastAutomatedUpdate: {
        type: Date,
        default: null
    },
    automationNotes: {
        type: [String],
        default: []
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    createdAt: { 
        type: Date, 
        default: Date.now,
        index: true
    },
    updatedAt: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    collection: "requests",
    timestamps: false,
    toJSON: {
        virtuals: true,
        transform: function(doc, ret) {
            ret.id = ret._id.toString();
            delete ret._id;
            delete ret.__v;
            if (ret.rejectionReason) {
                ret.rejectionReason = ret.rejectionReason;
            }
            return ret;
        }
    },
    toObject: {
        virtuals: true
    }
});

// Virtual for formatted date
requestSchema.virtual('formattedDate').get(function() {
    return this.createdAt.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
    });
});

// Virtual for formatted time
requestSchema.virtual('formattedTime').get(function() {
    return this.createdAt.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });
});

// Virtual for formatted scheduled claim date
requestSchema.virtual('formattedScheduledDate').get(function() {
    if (!this.scheduledClaimDate) return 'Not scheduled';
    return this.scheduledClaimDate.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
    });
});

// Virtual for formatted scheduled claim time
requestSchema.virtual('formattedScheduledTime').get(function() {
    if (!this.scheduledClaimTime) return 'Not scheduled';
    return this.scheduledClaimTime;
});

// NEW: Virtual for admin pickup period display
requestSchema.virtual('formattedAdminPickupPeriod').get(function() {
    if (!this.adminPickupPeriod.startDate || !this.adminPickupPeriod.endDate) {
        return 'Not set';
    }
    const start = this.adminPickupPeriod.startDate.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
    });
    const end = this.adminPickupPeriod.endDate.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
    });
    return `${start} to ${end}`;
});

// NEW: Virtual to check if admin has set pickup period
requestSchema.virtual('hasAdminPickupPeriod').get(function() {
    return !!(this.adminPickupPeriod.startDate && this.adminPickupPeriod.endDate);
});

// Virtual for estimated completion date
requestSchema.virtual('formattedEstimatedCompletion').get(function() {
    if (!this.estimatedCompletionDate) return 'Not set';
    return this.estimatedCompletionDate.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric'
    });
});

// Virtual for days in current status
requestSchema.virtual('daysInStatus').get(function() {
    const now = new Date();
    const statusDate = this.updatedAt || this.createdAt;
    const diffTime = Math.abs(now - statusDate);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// NEW: Virtual to check if request is expired
requestSchema.virtual('shouldBeExpired').get(function() {
    if (this.status !== 'Scheduled for Pickup' && this.status !== 'Ready to Claim') {
        return false;
    }
    
    const now = new Date();
    
    // For scheduled pickups, check if scheduled date has passed
    if (this.status === 'Scheduled for Pickup' && this.scheduledClaimDate) {
        const scheduledDateTime = new Date(this.scheduledClaimDate);
        if (this.scheduledClaimTime) {
            const [hours, minutes] = this.scheduledClaimTime.split(':').map(Number);
            scheduledDateTime.setHours(hours, minutes, 0, 0);
        }
        return isAfter(now, scheduledDateTime);
    }
    
    // For ready to claim, check if admin pickup period has ended
    if (this.status === 'Ready to Claim' && this.adminPickupPeriod.endDate) {
        const endOfPickupPeriod = endOfDay(new Date(this.adminPickupPeriod.endDate));
        return isAfter(now, endOfPickupPeriod);
    }
    
    return false;
});

// Calculate priority score based on various factors
requestSchema.methods.calculatePriorityScore = function() {
    let score = 0;
    
    // Priority based on document type
    const documentPriority = {
        'Barangay Clearance': 1,
        'Certificate of Residency': 2,
        'Certificate of Indigency': 3,
        'Business Permit': 4
    };
    
    this.documentTypes.forEach(docType => {
        score += documentPriority[docType] || 2;
    });
    
    // Priority based on purpose (emergency purposes get higher priority)
    if (this.purpose.includes('Emergency') || this.purpose.includes('Medical') || this.purpose.includes('Urgent')) {
        score += 5;
    }
    
    // Priority based on time in current status (older requests get higher priority)
    score += Math.min(this.daysInStatus, 10);
    
    return score;
};

// Method to estimate completion date based on document type
requestSchema.methods.calculateEstimatedCompletion = function() {
    const processingTimes = {
        'Barangay Clearance': 1, // 1 day
        'Certificate of Residency': 1, // 1 day
        'Certificate of Indigency': 2, // 2 days
        'Business Permit': 3 // 3 days
    };
    
    let maxDays = 1;
    this.documentTypes.forEach(docType => {
        maxDays = Math.max(maxDays, processingTimes[docType] || 2);
    });
    
    const completionDate = new Date(this.createdAt);
    completionDate.setDate(completionDate.getDate() + maxDays);
    
    // Skip weekends
    while (completionDate.getDay() === 0 || completionDate.getDay() === 6) {
        completionDate.setDate(completionDate.getDate() + 1);
    }
    
    return completionDate;
};

// Method to calculate auto-archive date
requestSchema.methods.calculateAutoArchiveDate = function() {
    const archiveDate = new Date();
    archiveDate.setDate(archiveDate.getDate() + 30); // Archive after 30 days
    return archiveDate;
};

// NEW: Method to generate time slots for admin pickup period
requestSchema.methods.generateTimeSlots = function() {
    if (!this.adminPickupPeriod.startDate || !this.adminPickupPeriod.endDate) {
        return [];
    }

    const slots = [];
    const startDate = new Date(this.adminPickupPeriod.startDate);
    const endDate = new Date(this.adminPickupPeriod.endDate);
    const currentDate = new Date(startDate);
    
    // Office hours: 8:00 AM to 4:00 PM, hourly slots (skip 12:00 PM for lunch)
    const timeSlots = ['08:00', '09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00'];
    
    // Generate slots for each day in the period
    while (currentDate <= endDate) {
        // Skip weekends (0 = Sunday, 6 = Saturday)
        if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
            timeSlots.forEach(time => {
                slots.push({
                    date: new Date(currentDate),
                    time: time,
                    isAvailable: true
                });
            });
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return slots;
};

// NEW: Method to check and update expiration status
requestSchema.methods.checkAndUpdateExpiration = function() {
    if (this.shouldBeExpired && !this.isExpired) {
        this.status = 'Expired';
        this.isExpired = true;
        this.expirationDate = new Date();
        this.automationNotes.push(`Request automatically expired on ${new Date().toLocaleString()}`);
        return true; // Changed
    }
    return false; // Not changed
};

// NEW: Method to check and archive expired requests
requestSchema.methods.checkAndArchive = function() {
    if (this.isExpired && this.status !== 'Archived') {
        // Archive expired requests after 7 days
        const expirationDate = this.expirationDate || this.updatedAt;
        const daysSinceExpiration = Math.ceil((new Date() - expirationDate) / (1000 * 60 * 60 * 24));
        
        if (daysSinceExpiration >= 7) {
            this.status = 'Archived';
            this.automationNotes.push(`Request automatically archived on ${new Date().toLocaleString()}`);
            return true; // Changed
        }
    }
    return false; // Not changed
};

// Add pre-save hook
requestSchema.pre('save', function(next) {
    if (this.isModified('status')) {
        this.updatedAt = new Date();
        if (this.status !== 'Rejected' && this.rejectionReason) {
            this.rejectionReason = undefined;
        }
        
        // Add automation note when status changes
        if (this.isModified('status') && this.lastAutomatedUpdate) {
            this.automationNotes.push(`Status auto-updated to ${this.status} on ${new Date().toLocaleString()}`);
        }
    }
    
    // NEW: Generate time slots when admin sets pickup period
    if (this.isModified('adminPickupPeriod') && this.adminPickupPeriod.startDate && this.adminPickupPeriod.endDate) {
        this.adminPickupPeriod.availableTimeSlots = this.generateTimeSlots();
    }
    
    // Calculate priority score for new requests
    if (this.isNew) {
        this.priorityScore = this.calculatePriorityScore();
        this.estimatedCompletionDate = this.calculateEstimatedCompletion();
        this.autoArchiveDate = this.calculateAutoArchiveDate();
    }
    
    next();
});

// Add indexes
requestSchema.index({ status: 1, userId: 1 });
requestSchema.index({ createdAt: -1 });
requestSchema.index({ updatedAt: -1 });
requestSchema.index({ scheduledClaimDate: 1 });
requestSchema.index({ priorityScore: -1 });
requestSchema.index({ estimatedCompletionDate: 1 });
requestSchema.index({ autoArchiveDate: 1 });    
requestSchema.index({ 'adminPickupPeriod.startDate': 1 });
requestSchema.index({ 'adminPickupPeriod.endDate': 1 });
requestSchema.index({ isExpired: 1 }); // NEW: Index for expiration
requestSchema.index({ expirationDate: 1 }); // NEW: Index for expiration date

const Request = mongoose.model("Request", requestSchema);

// NEW: Static method to process automatic expiration and archiving
Request.processAutomaticUpdates = async function() {
    try {
        console.log('🔄 Processing automatic request updates...');
        
        // Find requests that should be expired
        const requestsToExpire = await this.find({
            status: { $in: ['Scheduled for Pickup', 'Ready to Claim'] },
            isExpired: false
        });
        
        let expiredCount = 0;
        let archivedCount = 0;
        
        for (const request of requestsToExpire) {
            const requestObj = request.toObject();
            const shouldBeExpired = requestObj.shouldBeExpired;
            
            if (shouldBeExpired) {
                await this.findByIdAndUpdate(request._id, {
                    status: 'Expired',
                    isExpired: true,
                    expirationDate: new Date(),
                    $push: { 
                        automationNotes: `Request automatically expired on ${new Date().toLocaleString()}` 
                    },
                    updatedAt: new Date()
                });
                expiredCount++;
                console.log(`📄 Expired request: ${request._id}`);
            }
        }
        
        // Find expired requests that should be archived (after 7 days)
        const expiredRequests = await this.find({
            isExpired: true,
            status: 'Expired'
        });
        
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        for (const request of expiredRequests) {
            const expirationDate = request.expirationDate || request.updatedAt;
            if (expirationDate <= sevenDaysAgo) {
                await this.findByIdAndUpdate(request._id, {
                    status: 'Archived',
                    $push: { 
                        automationNotes: `Request automatically archived on ${new Date().toLocaleString()}` 
                    },
                    updatedAt: new Date()
                });
                archivedCount++;
                console.log(`📦 Archived request: ${request._id}`);
            }
        }
        
        console.log(`✅ Automatic updates completed: ${expiredCount} expired, ${archivedCount} archived`);
        return { expiredCount, archivedCount };
        
    } catch (error) {
        console.error('❌ Error processing automatic updates:', error);
        throw error;
    }
};

module.exports = Request;