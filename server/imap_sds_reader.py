from imap_tools import MailBox
import pdfplumber
import pandas as pd
import os
import re
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

# ==========================
# Gmail Configuration
# ==========================
EMAIL = "heypk4@gmail.com"
APP_PASSWORD = "pnfg uayo gyki zejc"

DOWNLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "downloads")
OUTPUT_JSON = os.path.join(os.path.dirname(__file__), "sds_extracted_data.json")
OUTPUT_EXCEL = os.path.join(os.path.dirname(__file__), "sds_extracted_data.xlsx")

os.makedirs(DOWNLOAD_FOLDER, exist_ok=True)

all_records = []


# ==========================
# PDF Text Extraction
# ==========================
def extract_pdf_text(pdf_path):
    text = ""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
    except Exception as e:
        print(f"PDF Error: {e}", file=sys.stderr)
    return text


# ==========================
# Universal Revision Date
# ==========================
def extract_revision_date(text):
    date_patterns = [
        r'\d{1,2}/\d{1,2}/\d{4}',
        r'\d{4}-\d{2}-\d{2}',
        r'\d{1,2}-[A-Za-z]{3}-\d{4}',
        r'[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}'
    ]
    lines = text.split('\n')
    for i, line in enumerate(lines):
        if any(keyword in line.lower() for keyword in [
            'revision', 'revision date', 'date of revision',
            'revised', 'last revision', 'version'
        ]):
            nearby_text = " ".join(lines[i:i+5])
            for pattern in date_patterns:
                match = re.search(pattern, nearby_text)
                if match:
                    return match.group()
    return None


# ==========================
# Generic Field Extractor
# ==========================
def extract_field(patterns, text):
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = match.group(1)
            value = value.replace("\n", " ")
            return value.strip()
    return None


# ==========================
# GHS Classification Extractor
# ==========================
def extract_ghs_tags(text):
    ghs_keywords = [
        "Flammable", "Toxic", "Corrosive", "Health Hazard",
        "Environmental", "Oxidizing", "Compressed Gas", "Explosive",
        "Acute toxicity", "Skin corrosion", "Eye damage",
        "Respiratory sensitization", "Reproductive toxicity"
    ]
    found = []
    for kw in ghs_keywords:
        if re.search(kw, text, re.IGNORECASE):
            found.append(kw)
    return ", ".join(found) if found else None


# ==========================
# SDS Extraction
# ==========================
def extract_sds_fields(text):
    product_patterns = [
        r'Product name\s*[:\-]?\s*(.+)',
        r'Product identifier\s*[:\-]?\s*(.+)',
        r'Product Name\s*[:\-]?\s*(.+)'
    ]
    phone_patterns = [
        r'Emergency telephone number\s*[:\-]?\s*(.+)',
        r'Emergency telephone\s*[:\-]?\s*(.+)',
        r'CHEMTREC\s*[:\-]?\s*(.+)'
    ]

    product_name   = extract_field(product_patterns, text)
    emergency_phone = extract_field(phone_patterns, text)
    revision_date   = extract_revision_date(text)
    ghs_tags        = extract_ghs_tags(text)

    # Fallback: look for GHS block
    if not ghs_tags:
        ghs_match = re.search(
            r'Classification(.*?)(Label elements|SECTION 3|Section 3)',
            text, re.IGNORECASE | re.DOTALL
        )
        if ghs_match:
            ghs_tags = ghs_match.group(1).replace("\n", " ").strip()[:200]

    return {
        "productName": product_name,
        "emergencyContact": emergency_phone,
        "revisionDate": revision_date,
        "ghsClassification": ghs_tags
    }


# ==========================
# Read Gmail IMAP
# ==========================
def process_attachment(att):
    if not att.filename.lower().endswith('.pdf'):
        return None
    file_path = os.path.join(DOWNLOAD_FOLDER, att.filename)
    with open(file_path, 'wb') as f:
        f.write(att.payload)
    # Extract text
    text = extract_pdf_text(file_path)
    # Save debug text (optional, can be omitted for speed)
    # with open(file_path + '.txt', 'w', encoding='utf-8') as f:
    #     f.write(text)
    # Extract SDS fields
    extracted = extract_sds_fields(text)
    extracted['emailSubject'] = att.email_subject if hasattr(att, 'email_subject') else ''
    extracted['sender'] = att.sender if hasattr(att, 'sender') else ''
    extracted['fileName'] = att.filename
    extracted['receivedDate'] = att.date.strftime('%Y-%m-%d') if hasattr(att, 'date') else None
    extracted['processingStatus'] = 'Processed' if extracted['productName'] else 'Pending Review'
    extracted['vendorName'] = att.sender.split('<')[0].strip().strip('"') if hasattr(att, 'sender') else ''
    return extracted

# ==========================
# Read Gmail IMAP
# ==========================
try:
    print(json.dumps({"status": "connecting", "message": "Connecting to Gmail IMAP..."}))
    sys.stdout.flush()

    with MailBox('imap.gmail.com').login(EMAIL, APP_PASSWORD, initial_folder='INBOX') as mailbox:
        print(json.dumps({"status": "connected", "message": "Connected to Gmail IMAP successfully."}))
        sys.stdout.flush()

        attachments = []
        for msg in mailbox.fetch(limit=30, reverse=True):
            if not msg.attachments:
                continue
            for att in msg.attachments:
                attachments.append((msg, att))

        # Process attachments concurrently
        max_workers = int(os.getenv('MAX_WORKERS', '4'))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_att = {executor.submit(process_attachment, att): (msg, att) for msg, att in attachments}
            for future in as_completed(future_to_att):
                result = future.result()
                if result:
                    result['emailSubject'] = future_to_att[future][0].subject
                    result['sender'] = future_to_att[future][0].from_
                    all_records.append(result)
                    print(json.dumps({"status": "extracted", "fileName": result['fileName'], "data": result}))
                    sys.stdout.flush()
except Exception as e:
    print(json.dumps({"status": "error", "message": str(e)}))
    sys.exit(1)

except Exception as e:
    print(json.dumps({"status": "error", "message": str(e)}))
    sys.exit(1)


# ==========================
# Save JSON + Excel
# ==========================
if all_records:
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(all_records, f, indent=2, default=str)

    df = pd.DataFrame(all_records)
    df.to_excel(OUTPUT_EXCEL, index=False)

    print(json.dumps({
        "status": "complete",
        "message": f"Extracted {len(all_records)} SDS document(s).",
        "count": len(all_records),
        "records": all_records
    }))
else:
    print(json.dumps({"status": "complete", "message": "No PDF attachments found in inbox.", "count": 0, "records": []}))
