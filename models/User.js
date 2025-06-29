const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const UserSchema = new mongoose.Schema({
  // Basic Information
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true
  },
  firstName: {
    type: String,
    trim: true
  },
  lastName: {
    type: String,
    trim: true
  },
  middleName: {
    type: String,
    trim: true
  },
  suffix: {
    type: String,
    trim: true
  },

  // Contact Information
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email address']
  },
  contactNumber: {
    type: String,
    trim: true
  },
  alternateContact: {
    type: String,
    trim: true
  },
  address: {
    type: String,
    trim: true,
    default: 'Barangay Hall'
  },

  // Personal Information
  birthdate: {
    type: Date,
    default: new Date(2000, 0, 1),
    set: function (val) {
      if (!val) return null;
      return val instanceof Date ? val : new Date(val);
    }
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other']
  },
  civilStatus: {
    type: String,
    enum: ['Single', 'Married', 'Widowed', 'Separated']
  },

  // Socio-Economic Information
  occupation: {
    type: String
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
    ]
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
    ]
  },
  homeowner: {
    type: String,
    enum: ['Yes', 'No']
  },
  yearsResiding: {
    type: String,
    enum: [
      'Since birth',
      '1-5 years',
      '6-10 years',
      '11-20 years',
      '20+ years'
    ]
  },

  // Special Categories
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

  // Account Information
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
  isBanned: {
    type: Boolean,
    default: false
  },

  // Password Reset Fields
  resetPasswordToken: {
    type: String,
    select: false
  },
  resetPasswordExpires: {
    type: Date,
    select: false
  },
  resetPasswordVerified: {
    type: Boolean,
    default: false,
    select: false
  },

  // Admin Specific Fields
  adminSpecificFields: {
    position: {
      type: String,
      enum: ['Brgy. Captain', 'Secretary', 'Treasurer', 'Councilor', 'Other']
    },
    department: {
      type: String
    },
    isSuperAdmin: {
      type: Boolean,
      default: false
    }
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

// 🔒 Pre-save hook to hash password
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

// 📅 Pre-save hook to update 'updatedAt'
UserSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// 🔍 Password comparison method
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// 🔑 Create password reset token method
UserSchema.methods.createPasswordResetToken = function() {
  // Generate 6-digit OTP
  const otp = crypto.randomInt(100000, 999999).toString();
  
  // Set expiration (10 minutes from now)
  this.resetPasswordToken = otp;
  this.resetPasswordExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  this.resetPasswordVerified = false;
  
  return otp;
};

// 🚫 Clear password reset token method
UserSchema.methods.clearPasswordResetToken = function() {
  this.resetPasswordToken = undefined;
  this.resetPasswordExpires = undefined;
  this.resetPasswordVerified = undefined;
};

module.exports = mongoose.model('User', UserSchema);