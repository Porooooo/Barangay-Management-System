require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Admin = require('./models/Admin');

async function migrateAdmins() {
  try {
    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/your-db-name', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB');

    // Find all admin users
    console.log('🔍 Finding admin users...');
    const adminUsers = await User.find({ role: 'admin' }).lean();
    
    if (adminUsers.length === 0) {
      console.log('ℹ️ No admin users found to migrate');
      process.exit(0);
    }

    console.log(`📋 Found ${adminUsers.length} admin users to migrate`);

    // Migrate each admin user
    for (const user of adminUsers) {
      console.log(`🔄 Migrating admin: ${user.email}`);
      
      // Create new admin document
      const newAdmin = new Admin({
        fullName: user.fullName,
        email: user.email,
        password: user.password,
        position: user.adminSpecificFields?.position || 'Other',
        department: user.adminSpecificFields?.department || 'Office of the Barangay Captain',
        status: user.status || 'Active',
        createdAt: user.createdAt || new Date(),
        updatedAt: user.updatedAt || new Date()
      });

      // Save the new admin
      await newAdmin.save();
      console.log(`✅ Created new admin record for ${user.email}`);

      // Delete the old user record
      await User.findByIdAndDelete(user._id);
      console.log(`🗑️ Deleted old user record for ${user.email}`);
    }

    console.log('🎉 Migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrateAdmins();