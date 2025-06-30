const mongoose = require("mongoose");

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
        },
        enum: {
            values: ['Barangay Clearance', 'Business Permit', 'Certificate of Residency', 'Certificate of Indigency', 'Other'],
            message: 'Invalid document type'
        }
    },
    purpose: { 
        type: String, 
        required: [true, "Purpose is required"],
        trim: true,
        minlength: [10, "Purpose must be at least 10 characters long"]
    },
    status: { 
        type: String, 
        default: "Pending",
        enum: {
            values: ['Pending', 'Approved', 'Rejected', 'Ready to Claim', 'Claimed'],
            message: 'Invalid status'
        },
        index: true
    },
    rejectionReason: {
        type: String,
        trim: true
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
            // Include rejectionReason in the output
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

// Add pre-save hook to update updatedAt when status changes
requestSchema.pre('save', function(next) {
    if (this.isModified('status')) {
        this.updatedAt = new Date();
        
        // Clear rejection reason if status is changed from Rejected to something else
        if (this.status !== 'Rejected' && this.rejectionReason) {
            this.rejectionReason = undefined;
        }
    }
    next();
});

// Add index for frequently queried fields
requestSchema.index({ status: 1, userId: 1 });
requestSchema.index({ createdAt: -1 });
requestSchema.index({ updatedAt: -1 });

const Request = mongoose.model("Request", requestSchema);
    
module.exports = Request;