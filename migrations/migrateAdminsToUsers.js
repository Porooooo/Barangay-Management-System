// migrateAdminsToUsers.js
const mongoose = require('mongoose');
const Admin = require('./models/Admin');
const User = require('./models/User');
const dotenv = require('dotenv');

dotenv.config();

async function migrateAdmins() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log("✅ Connected to MongoDB");

    // Fetch all admins
    const admins = await Admin.find();
    console.log(`📋 Found ${admins.length} admins to migrate.`);

    for (const admin of admins) {
      // Check if user with the same email already exists
      const existingUser = await User.findOne({ email: admin.email });

      if (!existingUser) {
        // Migrate admin to User model
        const newUser = new User({
          fullName: admin.fullName,
          email: admin.email,
          status: admin.status || 'active',
          password: admin.password, // assumed already hashed
          role: 'admin',
          profilePicture: 'default-profile.png'
        });

        await newUser.save();
        console.log(`✅ Migrated admin: ${admin.email}`);
      } else {
        console.log(`⚠️  Skipped: User already exists for admin email: ${admin.email}`);
      }
    }

    console.log("🎉 Admin migration completed successfully.");
  } catch (error) {
    console.error("❌ Migration error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB");
  }
}

migrateAdmins();
