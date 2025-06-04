const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true
  },
  soloParent: {
    type: Boolean,
    default: false
},
  middleName: {
    type: String,
    trim: true
  },
  suffix: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please fill a valid email address']
  },
  contactNumber: {
    type: String,
    required: [true, 'Contact number is required'],
    trim: true
  },
  alternateContact: {
    type: String,
    trim: true
  },
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true
  },
  birthdate: {
    type: Date,
    required: [true, 'Birthdate is required']
  },
  civilStatus: {
    type: String,
    enum: ['Single', 'Married', 'Widowed', 'Separated']
    // optional by default
  },
  occupation: {
    type: String
    // optional by default
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
    // optional by default
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
    // optional by default
  },
  homeowner: {
    type: String,
    enum: ['Yes', 'No']
    // optional by default
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
    // optional by default
  },
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
  pregnant: {
    type: Boolean,
    default: false
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
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active'
  },
  role: {
    type: String,
    enum: ['resident', 'staff', 'admin'],
    default: 'resident'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Password comparison method
UserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
