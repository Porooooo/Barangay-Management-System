const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    contactNumber: { type: String, required: true },
    address: { type: String, required: true },
    birthdate: { type: Date, required: true },
    civilStatus: { 
        type: String, 
        required: true,
        enum: ['Single', 'Married', 'Widowed', 'Separated']
    },
    occupation: { 
        type: String, 
        required: true,
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
            'Freelancer',
            'Others'
        ]
    },
    educationalAttainment: { 
        type: String, 
        required: true,
        enum: ['Elementary Graduate', 'High School Graduate', 'Vocational Graduate', 'College Graduate', 'Post Graduate', 'None']
    },
    registeredVoter: { type: Boolean, default: false },
    fourPsMember: { type: Boolean, default: false },
    pwdMember: { type: Boolean, default: false },
    seniorCitizen: { type: Boolean, default: false },
    pregnant: { type: Boolean, default: false },
    password: { type: String, required: true },
    profilePicture: { type: String },
    notificationPreferences: {
        email: { type: Boolean, default: true },
        sms: { type: Boolean, default: true },
        push: { type: Boolean, default: true }
    },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);

module.exports = User;