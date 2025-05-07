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
        lowercase: true
    },
    address: { 
        type: String, 
        required: [true, "Address is required"],
        trim: true
    },
    documentType: { 
        type: String, 
        required: [true, "Document type is required"],
        enum: {
            values: ['Barangay Clearance', 'Business Permit', 'Certificate of Residency', 'Barangay ID', 'Other'],
            message: 'Invalid document type'
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
            values: ['Pending', 'Approved', 'Rejected'],
            message: 'Invalid status'
        }
    },
    createdAt: { 
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
            ret.id = ret._id;
            delete ret._id;
            delete ret.__v;
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

const Request = mongoose.model("Request", requestSchema);

module.exports = Request;