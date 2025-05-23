const mongoose = require('mongoose');

const blotterSchema = new mongoose.Schema({
    residentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Resident',
        required: true
    },
    incidentDate: {
        type: Date,
        required: true
    },
    location: {
        type: String,
        required: true
    },
    complaint: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['Pending', 'Under Investigation', 'Resolved', 'Dismissed'],
        default: 'Pending'
    },
    resolution: {
        type: String,
        default: ''
    },
    resolvedDate: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

blotterSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

const Blotter = mongoose.model('Blotter', blotterSchema);

module.exports = Blotter;