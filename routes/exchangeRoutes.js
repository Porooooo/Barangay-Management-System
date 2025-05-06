const express = require("express");
const router = express.Router();

// Sample route
router.get("/", (req, res) => {
    res.send("Plastic Bottle Exchange System");
});

// ✅ Ensure this line exists
module.exports = router;
