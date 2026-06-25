require('dotenv').config();
const express      = require('express');
const cors         = require('cors');
const compression  = require('compression');
const nodemailer   = require('nodemailer');
const { spawn }    = require('child_process');
const fs           = require('fs');
const path         = require('path');
const db           = require('./db');

const app = express();
app.use(compression()); // gzip all responses
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ── Simple in-memory cache ──────────────────────────────────────
const CACHE_TTL_MS = 30_000; // 30 seconds
const cache = new Map();
const getCache = (key) => {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.data;
};
const setCache = (key, data) => cache.set(key, { data, ts: Date.now() });
const clearCache = (...keys) => keys.forEach(k => cache.delete(k));

// ── Nodemailer transporter ───────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL,
    pass: process.env.APP_PASSWORD
  },
  pool: true,
  maxConnections: 5,
  maxMessages: 10
});

// Clean up dummy data on server start
async function cleanDummyData() {
  try {
    // Delete all files in downloads folder
    const files = await fs.promises.readdir(DOWNLOAD_FOLDER);
    await Promise.all(files.map(f => fs.promises.unlink(path.join(DOWNLOAD_FOLDER, f))));
    // Remove JSON and Excel export files if they exist
    const jsonPath = path.join(__dirname, 'sds_extracted_data.json');
    const excelPath = path.join(__dirname, 'sds_extracted_data.xlsx');
    if (fs.existsSync(jsonPath)) await fs.promises.unlink(jsonPath);
    if (fs.existsSync(excelPath)) await fs.promises.unlink(excelPath);
    console.log('🧹 Cleaned up dummy data');
  } catch (e) {
    console.error('Cleanup error:', e);
  }
}

// ── Health check ───────────────────────────────────────────────
app.get('/ping', (req, res) => res.json({ status: 'ok', service: 'Dow Chemical SDS Compliance API' }));

// ── GET /vendors (cached) ───────────────────────────────────────
app.get('/vendors', async (req, res) => {
  try {
    const cached = getCache('vendors');
    if (cached) return res.json(cached);
    const list = await db.getVendors();
    setCache('vendors', list);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /vendors ─────────────────────────────────────────────────
app.post('/vendors', async (req, res) => {
  try {
    const vendor = req.body;
    if (!vendor.id) vendor.id = 'v-' + Date.now();
    const saved = await db.saveVendor(vendor);
    clearCache('vendors'); // invalidate cache on write
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /vendors/:id ───────────────────────────────────────────────
app.delete('/vendors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteVendor(id);
    clearCache('vendors'); // invalidate cache on delete
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /users ───────────────────────────────────────────────────
app.post('/users', async (req, res) => {
  try {
    const user = req.body;
    if (!user.email) return res.status(400).json({ error: 'Email is required' });
    const saved = await db.saveUser(user);
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /send-emails ─────────────────────────────────────────────
// Sends branded HTML SDS/MSDS request emails to vendors
app.post('/send-emails', async (req, res) => {
  const { vendors, subject, body } = req.body;

  if (!vendors || !Array.isArray(vendors) || vendors.length === 0) {
    return res.status(400).json({ error: 'No vendors provided' });
  }

  const results = await Promise.allSettled(
    vendors.map(async (vendor) => {
      const htmlBody = buildHtmlEmail(vendor, body);
      const mailOptions = {
        from:    `"Dow Chemical Compliance" <${process.env.EMAIL}>`,
        to:      vendor.email,
        subject: subject || 'Action Required: Submit Updated SDS/MSDS Documentation – Dow Chemical',
        html:    htmlBody,
        text: body
          .replace('{vendor_name}', vendor.name)
          .replace('{contact_person}', vendor.contact || vendor.name)
      };
      try {
        await transporter.sendMail(mailOptions);
        console.log(`✅ Sent to ${vendor.email}`);
        return { vendor: vendor.email, name: vendor.name, status: 'sent' };
      } catch (err) {
        console.error(`❌ Failed to send to ${vendor.email}:`, err.message);
        return { vendor: vendor.email, name: vendor.name, status: 'failed', error: err.message };
      }
    })
  );

  res.json({ results: results.map(r => r.value || r.reason) });
});

// ── POST /run-imap-scan ──────────────────────────────────────────
// Executes the Python IMAP script and streams progress, returns extracted SDS data
app.post('/run-imap-scan', (req, res) => {
  const scriptPath = path.join(__dirname, 'imap_sds_reader.py');

  if (!fs.existsSync(scriptPath)) {
    return res.status(500).json({ error: 'Python IMAP script not found.' });
  }

  const logs    = [];
  const records = [];
  let   finalResult = null;

  const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
  const proc  = spawn(pyCmd, [scriptPath], { cwd: __dirname });

  proc.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        logs.push(parsed);
        if (parsed.status === 'complete') {
          finalResult = parsed;
          if (parsed.records) records.push(...parsed.records);
        }
        if (parsed.status === 'extracted' && parsed.data) {
          records.push(parsed.data);
        }
      } catch {
        // non-JSON stdout line
      }
    }
  });

  proc.stderr.on('data', (chunk) => {
    console.error('Python stderr:', chunk.toString());
  });

  proc.on('close', async (code) => {
    if (code !== 0 && records.length === 0) {
      return res.status(500).json({
        error: 'Python script exited with error. Check server logs.',
        logs
      });
    }

    // Read local cache file
    const jsonFile = path.join(__dirname, 'sds_extracted_data.json');
    let fileRecords = [];
    if (fs.existsSync(jsonFile)) {
      try {
        fileRecords = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      } catch {}
    }

    const allRecords = records.length > 0 ? records : fileRecords;

    // Parallel SDS saves + vendor updates — much faster than sequential awaits
    const vendorsList = await db.getVendors();
    await Promise.allSettled(allRecords.map(async (rec) => {
      const isCompliant = rec.productName && rec.revisionDate && rec.emergencyContact;
      const compStatus = isCompliant ? 'Compliant' : 'Under Review';

      await db.saveSdsDocument({
        id: rec.id || 'sds-' + Math.random(),
        vendorName: rec.vendorName || rec.sender || 'Unknown Vendor',
        fileName: rec.fileName || 'sds_document.pdf',
        receivedDate: rec.receivedDate || new Date().toISOString().split('T')[0],
        productName: rec.productName || 'N/A',
        emergencyPhone: rec.emergencyContact || 'N/A',
        revisionDate: rec.revisionDate || 'N/A',
        ghsClassification: rec.ghsClassification || 'None Found',
        processingStatus: isCompliant ? 'Processed' : 'Failed',
        failureReason: isCompliant ? '' : 'Missing critical section parameters'
      });

      const match = vendorsList.find(v =>
        v.name.toLowerCase() === (rec.vendorName || '').toLowerCase() ||
        v.email.toLowerCase() === (rec.sender || '').toLowerCase()
      );
      if (match) {
        await db.saveVendor({
          ...match,
          lastResponseDate: rec.receivedDate || new Date().toISOString().split('T')[0],
          status: 'Responded',
          complianceStatus: compStatus
        });
      }
    }));
    clearCache('vendors', 'sds-data');

    res.json({
      status:  'complete',
      message: finalResult ? finalResult.message : `Scan complete. ${allRecords.length} record(s) found.`,
      count:   allRecords.length,
      records: allRecords,
      logs
    });
  });

  proc.on('error', (err) => {
    res.status(500).json({
      error: `Failed to start Python: ${err.message}.`
    });
  });
});

// ── GET /sds-data (cached) ────────────────────────────────────────────
app.get('/sds-data', async (req, res) => {
  try {
    const cached = getCache('sds-data');
    if (cached) return res.json(cached);
    const list = await db.getSdsDocuments();
    const payload = { records: list, count: list.length };
    setCache('sds-data', payload);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read SDS data.' });
  }
});

// ────────────────────────────────────────────────────────────────
// HTML Email Builder — Dow Chemical Professional Brand Template
// ────────────────────────────────────────────────────────────────
function buildHtmlEmail(vendor, bodyText) {
  const contactName = vendor.contact || vendor.name;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Supplier Compliance Documentation Request – Dow Chemical</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F6F9;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">

<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F4F6F9;padding:32px 16px;">
  <tr>
    <td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);border:1px solid #E1E4E8;">

        <!-- HEADER BANNER -->
        <tr>
          <td style="background-color:#0054A6;padding:32px 40px;text-align:left;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <!-- Brand Identity -->
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width:36px;height:36px;background-color:rgba(255,255,255,0.15);border-radius:6px;text-align:center;line-height:36px;font-size:18px;font-weight:900;color:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;">⬡</td>
                      <td style="padding-left:12px;font-family:'Helvetica Neue',Arial,sans-serif;">
                        <div style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;line-height:1.2;">DOW CHEMICAL</div>
                        <div style="font-size:10px;color:rgba(255,255,255,0.7);letter-spacing:0.06em;text-transform:uppercase;margin-top:2px;">Global Supplier Compliance</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding-top:24px;">
                  <h1 style="margin:0;font-size:22px;color:#ffffff;font-weight:700;line-height:1.3;font-family:'Helvetica Neue',Arial,sans-serif;">
                    Supplier Compliance Documentation Request
                  </h1>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- MAIN CARD CONTAINER -->
        <tr>
          <td style="padding:40px 40px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              
              <!-- GREETING -->
              <tr>
                <td>
                  <p style="margin:0 0 16px;font-size:15px;color:#24292E;font-weight:700;font-family:'Helvetica Neue',Arial,sans-serif;">
                    Dear ${contactName},
                  </p>
                </td>
              </tr>

              <!-- INTRODUCTION -->
              <tr>
                <td>
                  <p style="margin:0 0 24px;font-size:14px;color:#586069;line-height:1.6;font-family:'Helvetica Neue',Arial,sans-serif;">
                    As part of Dow Chemical's Supplier Compliance and Product Stewardship Program, we require updated Safety Data Sheet (SDS/MSDS) documentation for products supplied to Dow Chemical by <strong>${vendor.name}</strong>.
                  </p>
                </td>
              </tr>

              <!-- ACTION REQUIRED SECTION (Blue Highlight Box) -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F0F7FF;border-left:4px solid #0054A6;border-radius:0 6px 6px 0;">
                    <tr>
                      <td style="padding:20px;">
                        <h3 style="margin:0 0 8px;font-size:14px;color:#0054A6;font-weight:700;font-family:'Helvetica Neue',Arial,sans-serif;text-transform:uppercase;letter-spacing:0.04em;">
                          ⚠ Action Required
                        </h3>
                        <p style="margin:0 0 12px;font-size:13px;color:#24292E;line-height:1.5;font-family:'Helvetica Neue',Arial,sans-serif;">
                          Please reply directly to this email and attach your latest SDS/MSDS documentation.
                        </p>
                        
                        <!-- Accepted Formats modern checklist -->
                        <table cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="font-size:12px;color:#0054A6;font-weight:700;padding-right:16px;font-family:'Helvetica Neue',Arial,sans-serif;">✓ PDF</td>
                            <td style="font-size:12px;color:#0054A6;font-weight:700;padding-right:16px;font-family:'Helvetica Neue',Arial,sans-serif;">✓ SDS</td>
                            <td style="font-size:12px;color:#0054A6;font-weight:700;font-family:'Helvetica Neue',Arial,sans-serif;">✓ MSDS</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- REQUIRED INFORMATION CARD -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E1E4E8;border-radius:6px;background-color:#ffffff;">
                    <tr>
                      <td style="padding:20px;">
                        <h4 style="margin:0 0 12px;font-size:13px;color:#24292E;font-weight:700;font-family:'Helvetica Neue',Arial,sans-serif;">
                          The submitted SDS/MSDS should contain:
                        </h4>
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td width="50%" style="font-size:13px;color:#586069;padding:6px 0;font-family:'Helvetica Neue',Arial,sans-serif;">
                              <span style="color:#0054A6;font-weight:bold;margin-right:6px;">✓</span> Product Name
                            </td>
                            <td width="50%" style="font-size:13px;color:#586069;padding:6px 0;font-family:'Helvetica Neue',Arial,sans-serif;">
                              <span style="color:#0054A6;font-weight:bold;margin-right:6px;">✓</span> Emergency Telephone Number
                            </td>
                          </tr>
                          <tr>
                            <td style="font-size:13px;color:#586069;padding:6px 0;font-family:'Helvetica Neue',Arial,sans-serif;">
                              <span style="color:#0054A6;font-weight:bold;margin-right:6px;">✓</span> Revision Date (within 3 years)
                            </td>
                            <td style="font-size:13px;color:#586069;padding:6px 0;font-family:'Helvetica Neue',Arial,sans-serif;">
                              <span style="color:#0054A6;font-weight:bold;margin-right:6px;">✓</span> GHS Classification
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- DEADLINE CARD (Warning-style Box) -->
              <tr>
                <td style="padding-bottom:24px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF8F2;border:1px solid #FFE0C2;border-radius:6px;">
                    <tr>
                      <td style="padding:16px 20px;">
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="font-size:13px;color:#A05E00;font-weight:700;font-family:'Helvetica Neue',Arial,sans-serif;">
                              ⏱ Submission Deadline
                            </td>
                          </tr>
                          <tr>
                            <td style="padding-top:4px;font-size:13px;color:#586069;line-height:1.5;font-family:'Helvetica Neue',Arial,sans-serif;">
                              Please submit the updated documentation within <strong>14 calendar days</strong> of receiving this request to maintain active compliance standing.
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- PRIMARY CTA BUTTON -->
              <tr>
                <td align="center" style="padding:16px 0 32px;">
                  <table cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <a href="mailto:${process.env.EMAIL}?subject=SDS/MSDS Submission - ${encodeURIComponent(vendor.name)}" style="display:inline-block;background-color:#0054A6;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:4px;font-family:'Helvetica Neue',Arial,sans-serif;box-shadow:0 2px 4px rgba(0,84,166,0.2);">
                          Reply With SDS/MSDS Document
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- SUPPORT SECTION CARD -->
              <tr>
                <td style="padding-bottom:16px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F6F8FA;border:1px solid #E1E4E8;border-radius:6px;text-align:center;">
                    <tr>
                      <td style="padding:16px 20px;font-family:'Helvetica Neue',Arial,sans-serif;">
                        <span style="font-size:13px;color:#586069;">Questions or support required? Email us at: </span>
                        <a href="mailto:supplier.compliance@dow.com" style="font-size:13px;color:#0054A6;font-weight:700;text-decoration:none;">supplier.compliance@dow.com</a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

            </table>
          </td>
        </tr>

        <!-- FOOTER & CONFIDENTIALITY NOTICE -->
        <tr>
          <td style="background-color:#F6F8FA;border-top:1px solid #E1E4E8;padding:24px 40px;text-align:left;font-family:'Helvetica Neue',Arial,sans-serif;">
            <p style="margin:0 0 12px;font-size:12px;color:#24292E;font-weight:700;line-height:1.5;">
              Dow Chemical<br/>
              <span style="font-size:11px;color:#586069;font-weight:normal;">
                Global Supplier Compliance Team<br/>
                Product Safety & Regulatory Affairs
              </span>
            </p>
            <p style="margin:0;font-size:10px;color:#959DA5;line-height:1.5;text-align:justify;">
              <strong>CONFIDENTIALITY NOTICE:</strong> This email, including any attachments, is for the sole use of the intended recipient(s) and may contain confidential or legally privileged information. If you are not the intended recipient, please immediately notify the sender, delete the email and all copies, and do not distribute or disclose its contents.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>

</body>
</html>`;
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`\n🟢 Dow Chemical SDS Compliance API running on port ${PORT}`);
  console.log(`   GET  /vendors        — Retrieve all vendors from database`);
  console.log(`   POST /vendors        — Create/update vendor in database`);
  console.log(`   DELETE /vendors/:id  — Delete vendor from database`);
  console.log(`   POST /users          — Register/sync portal user`);
  console.log(`   POST /send-emails    — Send SDS request emails to vendors`);
  console.log(`   POST /run-imap-scan  — Trigger Python IMAP inbox scan & store to database`);
  console.log(`   GET  /sds-data       — Retrieve previously extracted SDS data\n`);
});
