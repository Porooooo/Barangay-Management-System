const mongoose = require('mongoose');
const User = require('../models/User');
const dotenv = require('dotenv');

dotenv.config();

async function migrateRoles() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/test', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log("Connected to MongoDB");

    // Convert isAdmin: true to role: 'admin'
    const adminUpdateResult = await User.updateMany(
      { isAdmin: true },
      { $set: { role: 'admin' }, $unset: { isAdmin: "" } }
    ); 
    console.log(`Updated${adminUpdateResult.modifiedCount} admin users`);

    // Convert isAdmin: false or missing to role: 'resident'
    const residentUpdateResult = await User.updateMany(
        { $or: [{ isAdmin: false }, { isAdmin: { $exists: false } }] }, // <-- filter
        { $set: { role: 'resident' }, $unset: { isAdmin: "" } }         // <-- update
      );      
    console.log(`Updated ${residentUpdateResult.modifiedCount} resident users`);

    console.log("Migration completed successfully");
  } catch (error) {
    console.error("Migration error:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

migrateRoles();