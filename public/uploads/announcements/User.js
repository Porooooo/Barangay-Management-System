const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const UserSchema = new mongoose.Schema({
  // Basic Information (required for all users)
  fullName: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email address']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters long'],
    select: false
  },
  profilePicture: {
    type: String,
    default: 'default-profile.png'
  },
  role: {
    type: String,
    enum: ['resident', 'admin'],
    default: 'resident'
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active'
  },
  // NEW: Approval status field
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  // NEW: Rejection reason
  rejectionReason: {
    type: String,
    default: null
  },
  // NEW: Approval/Rejection timestamps
  approvedAt: {
    type: Date,
    default: null
  },
  rejectedAt: {
    type: Date,
    default: null
  },
  // NEW: Approved/Rejected by admin
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // NEW: ID Verification fields
  idVerification: {
    idType: {
      type: String,
      enum: ['National ID', 'Driver License', 'Passport', 'Voter ID', 'Barangay ID', 'Other'],
      default: null
    },
    idNumber: {
      type: String,
      default: null
    },
    idPhoto: {
      type: String, // File path for the uploaded ID photo
      default: null
    },
    submittedAt: {
      type: Date,
      default: null
    }
  },

  // Admin Specific Fields
  adminSpecificFields: {
    position: {
      type: String,
      enum: ['Brgy. Captain', 'Secretary', 'Treasurer', 'Councilor', 'Other']
    },
    department: {
      type: String
    }
  },

  // Personal Information
  firstName: {
    type: String,
    trim: true,
    default: null
  },
  lastName: {
    type: String,
    trim: true,
    default: null
  },
  middleName: {
    type: String,
    trim: true,
    default: null
  },
  suffix: {
    type: String,
    trim: true,
    default: null
  },
  contactNumber: {
    type: String,
    trim: true,
    default: null
  },
  alternateContact: {
    type: String,
    trim: true,
    default: null
  },
  address: {
    type: String,
    trim: true,
    default: null
  },
  houseNumber: {
    type: String,
    trim: true,
    default: null
  },
  street: {
    type: String,
    trim: true,
    default: null
  },
  barangay: {
    type: String,
    trim: true,
    default: 'Talipapa'
  },
  birthdate: {
    type: Date,
    default: null
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other'],
    default: null
  },
  civilStatus: {
    type: String,
    enum: ['Single', 'Married', 'Widowed', 'Separated'],
    default: null
  },
  occupation: {
    type: String,
    enum: [
      'Unemployed',
      'Student',
      'Government Employee',
      'Private Employee',
      'Self-Employed',
      'Business Owner',
      'Retired',
      'OFW',
      'Other'
    ],
    default: null
  },
  educationalAttainment: {
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
  monthlyIncome: {
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
  homeowner: {
    type: String,
    enum: ['Yes', 'No'],
    default: null
  },
  yearsResiding: {
    type: String,
    enum: [
      'Since birth',
      '1-5 years',
      '6-10 years',
      '11-20 years',
      '20+ years'
    ],
    default: null
  },
  
  // Government Program Participation
  registeredVoter: {
    type: Boolean,
    default: false
  },
  fourPsMember: {
    type: Boolean,
    default: false
  },
  pwdMember: {
    type: Boolean,
    default: false
  },
  seniorCitizen: {
    type: Boolean,
    default: false
  },
  soloParent: {
    type: Boolean,
    default: false
  },
  isBanned: {
    type: Boolean,
    default: false
  },

  // Comment notifications
  commentNotifications: {
    type: Boolean,
    default: true
  },
  lastSeenAnnouncements: {
    type: Date,
    default: Date.now
  },

  // Password Reset Fields
  resetPasswordToken: {
    type: String,
    select: false,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    select: false,
    default: null
  },
  resetPasswordVerified: {
    type: Boolean,
    default: false,
    select: false
  },

  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Pre-save hook to hash password
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Pre-save hook to update 'updatedAt'
UserSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// Method to generate full name from components
UserSchema.methods.generateFullName = function() {
  let fullName = '';
  if (this.firstName) fullName += this.firstName;
  if (this.middleName) fullName += ' ' + this.middleName;
  if (this.lastName) fullName += ' ' + this.lastName;
  if (this.suffix) fullName += ' ' + this.suffix;
  
  return fullName.trim();
};

// Pre-save hook to generate fullName if not provided
UserSchema.pre('save', function(next) {
  if ((!this.fullName || this.isModified('firstName') || this.isModified('lastName')) && 
      (this.firstName || this.lastName)) {
    this.fullName = this.generateFullName();
  }
  next();
});

// Password comparison method
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Create password reset token method
UserSchema.methods.createPasswordResetToken = function() {
  // Generate 6-digit OTP
  const otp = crypto.randomInt(100000, 999999).toString();
  
  // Set expiration (10 minutes from now)
  this.resetPasswordToken = otp;
  this.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  this.resetPasswordVerified = false;
  
  return otp;
};

// Clear password reset token method
UserSchema.methods.clearPasswordResetToken = function() {
  this.resetPasswordToken = undefined;
  this.resetPasswordExpires = undefined;
  this.resetPasswordVerified = undefined;
};

// Virtual for profile picture URL
UserSchema.virtual('profilePictureUrl').get(function() {
  if (this.profilePicture) {
    return `/uploads/profile-pictures/${this.profilePicture}`;
  }
  return '/images/default-profile.png';
});

// Virtual for ID photo URL
UserSchema.virtual('idPhotoUrl').get(function() {
  if (this.idVerification?.idPhoto) {
    return `/uploads/${this.idVerification.idPhoto}`;
  }
  return '/images/default-id.png';
});

// Virtual for checking if user is approved
UserSchema.virtual('isApproved').get(function() {
  return this.approvalStatus === 'approved';
});

// Virtual for checking if user is pending
UserSchema.virtual('isPending').get(function() {
  return this.approvalStatus === 'pending';
});

module.exports = mongoose.model('User', UserSchema);