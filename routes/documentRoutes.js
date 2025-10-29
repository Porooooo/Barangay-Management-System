const express = require("express");
const DocumentService = require("../services/documentService");
const Blotter = require("../models/Blotter");

const router = express.Router();

// Middleware to verify session
const verifySession = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ 
            error: "Unauthorized", 
            message: "Please log in to access this resource" 
        });
    }
    next();
};

// Generate Summons for a specific blotter
router.get("/summons/:blotterId", verifySession, async (req, res) => {
    try {
        const blotter = await Blotter.findById(req.params.blotterId).populate('complainant', 'fullName');
        
        if (!blotter) {
            return res.status(404).json({
                error: "Not found",
                message: "Blotter not found"
            });
        }

        const document = await DocumentService.generateSummons(blotter);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename=summons-${blotter._id}.docx`);
        
        res.send(document);
    } catch (error) {
        console.error("Error generating summons:", error);
        res.status(500).json({
            error: "Server error",
            message: "Failed to generate summons document"
        });
    }
});

// Generate CFA for a specific blotter
router.get("/cfa/:blotterId", verifySession, async (req, res) => {
    try {
        const blotter = await Blotter.findById(req.params.blotterId).populate('complainant', 'fullName');
        
        if (!blotter) {
            return res.status(404).json({
                error: "Not found",
                message: "Blotter not found"
            });
        }

        const document = await DocumentService.generateCFA(blotter);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename=cfa-${blotter._id}.docx`);
        
        res.send(document);
    } catch (error) {
        console.error("Error generating CFA:", error);
        res.status(500).json({
            error: "Server error",
            message: "Failed to generate CFA document"
        });
    }
});



// Batch generate documents for multiple cases
router.post("/batch/:documentType", verifySession, async (req, res) => {
    try {
        const { caseIds } = req.body;
        const { documentType } = req.params;

        if (!caseIds || !Array.isArray(caseIds)) {
            return res.status(400).json({
                error: "Validation error",
                message: "Case IDs array is required"
            });
        }

        const zipBuffer = await DocumentService.batchGenerateDocuments(caseIds, documentType);
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=batch-${documentType}-${new Date().toISOString().split('T')[0]}.zip`);
        
        res.send(zipBuffer);
    } catch (error) {
        console.error("Error generating batch documents:", error);
        res.status(500).json({
            error: "Server error",
            message: "Failed to generate batch documents"
        });
    }
});

module.exports = router;