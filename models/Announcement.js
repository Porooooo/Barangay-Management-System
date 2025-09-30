const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userName: {
    type: String,
    required: true
  },
  userProfilePicture: {
    type: String,
    default: null
  },
  userRole: {
    type: String,
    enum: ['admin', 'resident'],
    default: 'resident'
  },
  text: {
    type: String,
    required: true,
    trim: true
  },
  replies: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    userName: {
      type: String,
      required: true
    },
    userProfilePicture: {
      type: String,
      default: null
    },
    userRole: {
      type: String,
      enum: ['admin', 'resident'],
      default: 'resident'
    },
    text: {
      type: String,
      required: true,
      trim: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const AnnouncementSchema = new mongoose.Schema({
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
  imageUrl: {
    type: String,
    default: null
  },
  targetGroups: [{
    type: String,
    enum: [
      'All Residents',
      'PWD Member',
      'Senior Citizen',
      'Registered Voter',
      '4Ps Member',
      'Solo Parent'
    ]
  }],
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
    enum: [
      'Elementary Graduate',
      'High School Graduate',
      'Vocational Graduate',
      'College Graduate',
      'Post Graduate',
      'None'
    ],
    default: null
  },
  targetCivilStatus: {
    type: String,
    enum: ['Single', 'Married', 'Widowed', 'Separated'],
    default: null
  },
  targetIncome: {
    type: String,
    enum: [
      'Below 5,000',
      '5,000-10,000',
      '10,001-20,000',
      '20,001-30,000',
      '30,001-50,000',
      'Above 50,000'
    ],
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
  comments: [CommentSchema],
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
AnnouncementSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Announcement', AnnouncementSchema);