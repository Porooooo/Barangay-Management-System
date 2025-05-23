const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  fullName: { 
    type: String, 
    required: [true, "Full name is required"],
    trim: true,
    maxlength: [100, "Full name cannot exceed 100 characters"]
  },
  email: { 
    type: String, 
    required: [true, "Email is required"],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Please fill a valid email address"]
  },
  contactNumber: { 
    type: String, 
    required: [true, "Contact number is required"],
    match: [/^[0-9]{10,15}$/, "Please fill a valid contact number"]
  },
  address: { 
    type: String, 
    required: [true, "Address is required"],
    maxlength: [200, "Address cannot exceed 200 characters"]
  },
  birthdate: { 
    type: Date, 
    required: [true, "Birthdate is required"],
    validate: {
      validator: function(value) {
        return value < new Date();
      },
      message: "Birthdate must be in the past"
    }
  },
  civilStatus: { 
    type: String, 
    required: true,
    enum: ['Single', 'Married', 'Widowed', 'Separated'],
    default: 'Single'
  },
  occupation: { 
    type: String, 
    required: true
  },
  educationalAttainment: { 
    type: String, 
    required: true,
    enum: ['Elementary Graduate', 'High School Graduate', 'Vocational Graduate', 'College Graduate', 'Post Graduate', 'None'],
    default: 'High School Graduate'
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
    required: [true, "Password is required"],
    minlength: [8, "Password must be at least 8 characters long"],
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
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      delete ret.password;
      return ret;
    }
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);

module.exports = User;