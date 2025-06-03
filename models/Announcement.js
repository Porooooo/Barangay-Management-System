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
        enum: ['All Residents', 'Registered Voter', '4Ps Member', 'PWD Member', 'Senior Citizen', 'Pregnant']
    }],
    targetCivilStatus: [{
        type: String,
        enum: ['Single', 'Married', 'Widowed', 'Separated']
    }],
    targetOccupation: [{
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
        ]
    }],
    targetEducation: [{
        type: String,
        enum: ['Elementary Graduate', 'High School Graduate', 'Vocational Graduate', 'College Graduate', 'Post Graduate', 'None']
    }],
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

const Announcement = mongoose.model('Announcement', announcementSchema);

module.exports = Announcement;