const mongoose = require('mongoose');
const Blotter = require('../models/Blotter');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fs = require('fs');
const path = require('path');

class DocumentService {
    
    constructor() {
        this.templates = {
            summons: this.loadTemplate('summon-template.docx'),
            cfa: this.loadTemplate('cfa-template.docx'),
            mediation: this.loadTemplate('mediation-template.docx'),
            settlement: this.loadTemplate('settlement-template.docx')
        };
    }

    loadTemplate(templateName) {
        try {
            const templatePath = path.join(__dirname, '../templates', templateName);
            return fs.readFileSync(templatePath, 'binary');
        } catch (error) {
            console.warn(`Template ${templateName} not found, using fallback`);
            return null;
        }
    }

    // Generate Summons Document
    async generateSummons(blotterData) {
        const template = this.templates.summons || this.createSummonsTemplate();
        
        const data = {
            caseNumber: `BB-${blotterData._id.toString().slice(-6).toUpperCase()}`,
            complaintType: blotterData.complaintType,
            respondent: blotterData.accused.name,
            hearingDate: this.formatDate(blotterData.hearingDate || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)),
            hearingTime: '09:00 AM',
            venue: 'Barangay Talipapa Hall',
            issuedBy: 'MIRASOL A. DELA CRUZ - Punong Barangay',
            issueDate: this.formatDate(new Date()),
            complainant: blotterData.complainantName,
            incidentDate: this.formatDate(blotterData.incidentDate),
            location: blotterData.location,
            details: blotterData.complaintDetails
        };

        return await this.generateDocument(template, data, 'summons');
    }

    // Generate Certification to File Action (CFA)
    async generateCFA(blotterData) {
        const template = this.templates.cfa || this.createCFATemplate();
        
        const data = {
            caseNumber: `BB-${blotterData._id.toString().slice(-6).toUpperCase()}`,
            complainant: blotterData.complainantName,
            respondent: blotterData.accused.name,
            reason: this.getCFAReason(blotterData),
            issueDate: this.formatDate(new Date()),
            signingOfficials: [
                'FLORDELIZA C. SANDAAN - Pangkat Secretary',
                'ROLANDO C. MANINGAS - Lupon Tagapagkasundo',
                'NERISSA ALEJANDRO - Lupon Tagapagkasundo', 
                'RAMON T. GARCIA - Lupon Tagapagkasundo'
            ],
            incidentDate: this.formatDate(blotterData.incidentDate),
            complaintType: blotterData.complaintType
        };

        return await this.generateDocument(template, data, 'cfa');
    }

    // Generate all documents for a blotter case
    async generateAllDocuments(blotterId) {
        const blotter = await Blotter.findById(blotterId).populate('complainant', 'fullName');
        
        const documents = [];
        
        // Generate summons if under investigation
        if (blotter.status === 'Under Investigation') {
            const summons = await this.generateSummons(blotter);
            documents.push({
                name: `Summons-${blotterId}.docx`,
                content: summons
            });
        }

        // Generate CFA if escalated
        if (blotter.status === 'Escalated to PNP') {
            const cfa = await this.generateCFA(blotter);
            documents.push({
                name: `CFA-${blotterId}.docx`,
                content: cfa
            });
        }

        // Generate mediation notice if scheduled
        if (blotter.hearingDate) {
            const mediation = await this.generateMediationNotice(blotter);
            documents.push({
                name: `Mediation-Notice-${blotterId}.docx`,
                content: mediation
            });
        }

        // Generate settlement agreement if resolved amicably
        if (blotter.status === 'Resolved' && blotter.resolutionDetails.includes('amicably')) {
            const settlement = await this.generateSettlement(blotter);
            documents.push({
                name: `Settlement-Agreement-${blotterId}.docx`,
                content: settlement
            });
        }

        return this.createZipPackage(documents, `Blotter-${blotterId}-Documents.zip`);
    }

    // Batch generate documents for multiple cases
    async batchGenerateDocuments(caseIds, documentType) {
        const documents = [];
        
        for (const caseId of caseIds) {
            const blotter = await Blotter.findById(caseId).populate('complainant', 'fullName');
            
            let document;
            switch (documentType) {
                case 'summons':
                    document = await this.generateSummons(blotter);
                    break;
                case 'cfa':
                    document = await this.generateCFA(blotter);
                    break;
                case 'mediation':
                    document = await this.generateMediationNotice(blotter);
                    break;
                default:
                    continue;
            }

            documents.push({
                name: `${documentType}-${caseId}.docx`,
                content: document
            });
        }

        return this.createZipPackage(documents, `Batch-${documentType}-${new Date().toISOString().split('T')[0]}.zip`);
    }

    // Helper method to generate document from template
    async generateDocument(templateContent, data, documentType) {
        try {
            const zip = new PizZip(templateContent);
            const doc = new Docxtemplater(zip, {
                paragraphLoop: true,
                linebreaks: true,
            });

            doc.setData(data);
            doc.render();

            return doc.getZip().generate({ type: 'nodebuffer' });
        } catch (error) {
            console.error('Error generating document:', error);
            // Fallback to simple text generation
            return this.generateFallbackDocument(data, documentType);
        }
    }

    // Fallback document generation
    generateFallbackDocument(data, documentType) {
        let content = '';
        
        switch (documentType) {
            case 'summons':
                content = this.createSummonsText(data);
                break;
            case 'cfa':
                content = this.createCFAText(data);
                break;
            default:
                content = JSON.stringify(data, null, 2);
        }

        return Buffer.from(content, 'utf8');
    }

    // Create summons template text (fallback)
    createSummonsText(data) {
        return `
REPUBLIKA NG PILIPINAS
Lalawigan ng Nueva Ecija
Lungsod ng Cabanatuan
BARANGAY TALIPAPA
TANGGAPAN NG LUPONG BARANGAY

${data.caseNumber} Usaping Barangay Blg. ${data.caseNumber}

Nagsumbong Ukol sa: ${data.complaintType}
${data.details}

-laban kay/kina-

${data.respondent}

IPINATATAWAG

KAY: ${data.respondent}

Sa pamamagitan nito, kayo ay ipinatawag upang personal na humarap sa akin 
kasama ang inyong mga testigo, sa ${data.hearingDate} 
sa ganap na ${data.hearingTime}, upang sagutin ang sumbong na 
ginawa sa harap ko, na ang sipi ay kalakip nito, para mapagitnaan/pagkasunduin 
ang inyong (mga) alitan ng nagsusumbong.

Ngayong ${data.issueDate}.

${data.issuedBy}
Punong Barangay/Tagapangulo ng Lupon
        `;
    }

    // Create CFA template text (fallback)
    createCFAText(data) {
        return `
REPUBLIKA NG PILIPINAS
Lalawigan ng Nueva Ecija  
Lungsod ng Cabanatuan
BARANGAY TALIPAPA
TANGGAPAN NG LUPON TAGAPAMAYAPA

Petsa: ${data.issueDate}

${data.caseNumber} Usaping Brgy. Blg. ${data.caseNumber}

(${data.complainant})

LABAN KAY: ${data.respondent}

Para sa: ${data.reason}

PAGPAPATUNAY PARA MAGHAIN NG PORMAL NA SAKDAL
[Certification to File Action]

ITO AY NAGPAPATUNAY:

1. Na, ang magkabilang panig ay nagkaroon ng paghaharap at kasunduan.

2. Na, ang ipinagsusumbong ay hindi tumupad sa kanilang pinal na kasunduan.

3. Kung kaya't ang nasabing sumbong para sa nabanggit na usaping barangay 
   ay maaaring ihain sa hukuman o tanggapan ng pamahalaan.

${data.signingOfficials[0]}

NAGPAPATUNAY:

${data.signingOfficials[1]}
${data.signingOfficials[2]} 
${data.signingOfficials[3]}

Lupon Tagapagkasundo    Lupon Tagapagkasundo    Lupon Tagapagkasundo
        `;
    }

    // Create ZIP package for multiple documents
    createZipPackage(documents, zipName) {
        const JSZip = require('jszip');
        const zip = new JSZip();

        documents.forEach(doc => {
            zip.file(doc.name, doc.content);
        });

        return zip.generateAsync({ type: 'nodebuffer' });
    }

    // Helper methods
    formatDate(date) {
        return new Date(date).toLocaleDateString('fil-PH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    getCFAReason(blotter) {
        if (blotter.callAttempts >= 3) {
            return 'Failure to respond after 3 call attempts';
        }
        if (blotter.status === 'Escalated to PNP') {
            return 'Case requires police intervention';
        }
        return 'Failure to settle amicably during mediation';
    }

    // Template creation methods (fallbacks)
    createSummonsTemplate() {
        // Return a simple DOCX template buffer
        return this.createSummonsText({
            caseNumber: 'BB-XXXXXX',
            complaintType: '[Complaint Type]',
            respondent: '[Respondent Name]',
            hearingDate: '[Hearing Date]',
            hearingTime: '[Hearing Time]',
            venue: '[Venue]',
            issuedBy: '[Issued By]',
            issueDate: '[Issue Date]',
            complainant: '[Complainant]',
            incidentDate: '[Incident Date]',
            location: '[Location]',
            details: '[Details]'
        });
    }

    createCFATemplate() {
        return this.createCFAText({
            caseNumber: 'BB-XXXXXX',
            complainant: '[Complainant]',
            respondent: '[Respondent]',
            reason: '[Reason]',
            issueDate: '[Issue Date]',
            signingOfficials: [
                '[Official 1]',
                '[Official 2]',
                '[Official 3]',
                '[Official 4]'
            ]
        });
    }

    // Additional document generation methods
    async generateMediationNotice(blotterData) {
        // Implementation for mediation notice
        const data = {
            caseNumber: `BB-${blotterData._id.toString().slice(-6).toUpperCase()}`,
            hearingDate: this.formatDate(blotterData.hearingDate),
            hearingTime: '09:00 AM',
            venue: 'Barangay Talipapa Hall',
            parties: `${blotterData.complainantName} and ${blotterData.accused.name}`,
            issueDate: this.formatDate(new Date())
        };

        return await this.generateDocument(this.templates.mediation, data, 'mediation');
    }

    async generateSettlement(blotterData) {
        // Implementation for settlement agreement
        const data = {
            caseNumber: `BB-${blotterData._id.toString().slice(-6).toUpperCase()}`,
            parties: `${blotterData.complainantName} and ${blotterData.accused.name}`,
            settlementDate: this.formatDate(new Date()),
            terms: blotterData.resolutionDetails,
            witnesses: [
                'Barangay Official 1',
                'Barangay Official 2'
            ]
        };

        return await this.generateDocument(this.templates.settlement, data, 'settlement');
    }
}

module.exports = new DocumentService();