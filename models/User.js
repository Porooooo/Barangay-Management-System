const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    contactNumber: { type: String, required: true },
    address: { type: String, required: true },
    birthdate: { type: Date, required: true },
    civilStatus: { type: String, required: true },
    occupation: { type: String, required: true },
    educationalAttainment: { type: String, required: true },
    password: { type: String, required: true },
    profilePicture: { type: String } // Add profile picture field
});

const User = mongoose.model("User", userSchema);

module.exports = User;