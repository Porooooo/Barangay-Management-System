const mongoose = require('mongoose');

const blotterSchema = new mongoose.Schema({
    complainant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    incidentDate: {
        type: Date,
        required: true
    },
    dateReported: {
        type: Date,
        default: Date.now
    },
    location: {
        type: String,
        required: true
    },
    complaintType: {
        type: String,
        required: true,
        enum: [
            'Noise Complaint', 
            'Property Damage', 
            'Physical Altercation',
            'Theft',
            'Public Disturbance',
            'Domestic Dispute',
            'Illegal Parking',
            'Other'
        ]
    },
    complaintDetails: {
        type: String,
        required: true
    },
    accused: {
        name: {
            type: String,
            required: true
        },
        address: {
            type: String,
            required: true
        },
        contact: {
            type: String
        },
        _id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    },
    status: {
        type: String,
        enum: ['Pending', 'Under Investigation', 'Resolved', 'Dismissed', 'Escalated to PNP'],
        default: 'Pending'
    },
    resolutionDetails: {
        type: String,
        default: ''
    },
    callAttempts: {
        type: Number,
        default: 0
    },
    callHistory: [{
        date: {
            type: Date,
            default: Date.now
        },
        successful: Boolean,
        notes: String
    }],
    resolvedDate: {
        type: Date
    },
    isBanned: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

blotterSchema.virtual('complainantName').get(function() {
    return this.complainant ? this.complainant.fullName : 'Anonymous';
});

blotterSchema.set('toJSON', { virtuals: true });
blotterSchema.set('toObject', { virtuals: true });

const Blotter = mongoose.model('Blotter', blotterSchema);

module.exports = Blotter;