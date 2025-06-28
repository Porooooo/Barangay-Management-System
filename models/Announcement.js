const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    content: {
        type: String,
        required: true,
        trim: true
    },
    targetGroups: [{
        type: String,
        enum: ['All Residents', 'Registered Voter', '4Ps Member', 'PWD Member', 'Senior Citizen', 'Solo Parent']
    }],
    targetCivilStatus: {
        type: String,
        enum: ['Single', 'Married', 'Widowed', 'Separated'],
        default: null
    },
    targetOccupation: {
        type: String,
        enum: [
            'Government Employee', 
            'Private Employee', 
            'OFW', 
            'Business Owner', 
            'Farmer', 
            'Fisherman', 
            'Teacher', 
            'Nurse', 
            'Healthcare Worker', 
            'Driver', 
            'Construction Worker', 
            'Factory Worker', 
            'Household Helper', 
            'Student', 
            'Unemployed', 
            'Retired', 
            'Self-employed', 
            'Freelancer'
        ],
        default: null
    },
    targetEducation: {
        type: String,
        enum: ['Elementary Graduate', 'High School Graduate', 'Vocational Graduate', 'College Graduate', 'Post Graduate', 'None'],
        default: null
    },
    targetIncome: {
        type: String,
        enum: ['Below 5,000', '5,000-10,000', '10,001-20,000', '20,001-30,000', '30,001-50,000', 'Above 50,000'],
        default: null
    },
    imageUrl: {
        type: String,
        default: null
    },
    eventDateTime: {
        type: Date,
        required: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
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

// Update the updatedAt field before saving
announcementSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Add text index for search functionality
announcementSchema.index({
    title: 'text',
    content: 'text'
});

// Add a TTL index for automatic expiration after 24 hours
announcementSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 }); // 24 hours in seconds

const Announcement = mongoose.model('Announcement', announcementSchema);

module.exports = Announcement;