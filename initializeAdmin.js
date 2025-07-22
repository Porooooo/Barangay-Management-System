require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

async function initializeAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log("✅ Connected to MongoDB");

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: "barangaytalipapa7@gmail.com" });
    if (existingAdmin) {
      console.log("ℹ️ Admin account already exists");
      process.exit(0);
    }

    
    // Create admin user
    const admin = new User({
      fullName: "Super Admin",
      email: "barangaytalipapa7@gmail.com",
      password: "Admin1234#",
      role: "admin",
      status: "Active",
      address: "Barangay Hall",
      birthdate: new Date("2000-01-01"),
      profilePicture: "default-profile.png",
      adminSpecificFields: {
        position: "Brgy. Captain",
        department: "Administration",
        isSuperAdmin: true
      }
    });

    await admin.save();
    console.log("✅ Admin account created successfully");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error creating admin account:", error);
    process.exit(1);
  }
}

initializeAdmin();