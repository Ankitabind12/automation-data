import React, { useState } from 'react';
import { Search, Eye, FileText, RefreshCw, AlertTriangle, CheckCircle, FileDown, AlertCircle, X } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function SDSProcessingPage({
  sdsDocuments,
  setSdsDocuments,
  vendors,
  setVendors,
  onLogActivity,
  addToast,
  addNotification
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [isScanning, setIsScanning] = useState(false);
  const [scanLogs, setScanLogs] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);

  const filteredDocs = sdsDocuments.filter((doc) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = 
      doc.vendorName.toLowerCase().includes(q) || 
      (doc.productName && doc.productName.toLowerCase().includes(q)) ||
      doc.fileName.toLowerCase().includes(q);

    const matchesStatus = 
      statusFilter === 'All' || 
      doc.processingStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const runInboxScan = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setScanLogs([{ time: new Date().toLocaleTimeString(), text: 'Connecting to IMAP mailbox (heypk4@gmail.com)...', type: 'info' }]);

    try {
      const response = await fetch('http://localhost:4000/run-imap-scan', {
        method: 'POST'
      });
      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Failed to scan inbox');

      if (data.logs) {
        const formattedLogs = data.logs.map(l => ({
          time: new Date().toLocaleTimeString(),
          text: l.message || JSON.stringify(l),
          type: l.status === 'error' ? 'error' : l.status === 'success' ? 'success' : 'info'
        }));
        setScanLogs(formattedLogs);
      }

      if (data.records && data.records.length > 0) {
        const formattedRecords = data.records.map(rec => {
          // Normalize processing status
          const isCompliant = rec.productName && rec.revisionDate && rec.emergencyContact;
          return {
            id: rec.id || 'sds-' + Math.random(),
            vendorName: rec.vendorName || rec.sender || 'Unknown Vendor',
            fileName: rec.fileName || 'sds_document.pdf',
            receivedDate: rec.receivedDate || new Date().toISOString().split('T')[0],
            productName: rec.productName || 'N/A',
            emergencyPhone: rec.emergencyContact || 'N/A',
            revisionDate: rec.revisionDate || 'N/A',
            ghsClassification: rec.ghsClassification || 'None Found',
            processingStatus: isCompliant ? 'Processed' : 'Failed',
            failureReason: isCompliant ? '' : 'Missing product name, revision date, or emergency contact'
          };
        });

        // Add to main App documents state without duplicating
        setSdsDocuments(prev => {
          const existingFiles = new Set(prev.map(p => p.fileName));
          const uniques = formattedRecords.filter(r => !existingFiles.has(r.fileName));
          return [...uniques, ...prev];
        });

        // Update vendor status & log activity for each found record
        formattedRecords.forEach(rec => {
          const compStatus = rec.processingStatus === 'Processed' ? 'Compliant' : 'Under Review';
          
          setVendors(prev => prev.map(v => {
            // Match vendor by name or email
            if (v.name.toLowerCase() === rec.vendorName.toLowerCase() || v.email.toLowerCase() === rec.vendorName.toLowerCase()) {
              return {
                ...v,
                lastResponseDate: rec.receivedDate,
                status: 'Responded',
                complianceStatus: compStatus
              };
            }
            return v;
          }));

          // Log Activity and notification
          onLogActivity(
            rec.vendorName,
            null,
            rec.receivedDate,
            rec.processingStatus === 'Processed' ? 'Success' : 'Pending Review',
            compStatus
          );

          addNotification(
            rec.processingStatus === 'Processed' ? 'success' : 'warning',
            `SDS extracted for <strong>${rec.vendorName}</strong>. Status: <strong>${compStatus}</strong>.`
          );
        });

        addToast('success', 'Scan Complete', `Extracted & synchronized ${data.records.length} SDS documents successfully!`);
      } else {
        addToast('info', 'Scan Complete', 'No new SDS attachments found in inbox.');
      }
    } catch (err) {
      console.error(err);
      addToast('danger', 'Scan Failed', err.message);
      setScanLogs(p => [...p, { time: new Date().toLocaleTimeString(), text: `Error: ${err.message}`, type: 'error' }]);
    } finally {
      setIsScanning(false);
    }
  };

  const handleDownloadExcel = () => {
    if (sdsDocuments.length === 0) {
      addToast('warning', 'No Data', 'No SDS data available to export.');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(sdsDocuments.map((d, i) => ({
      "S.No": i + 1,
      "Vendor Name": d.vendorName,
      "Product Name": d.productName,
      "Emergency Contact": d.emergencyPhone,
      "Revision Date": d.revisionDate,
      "GHS Classification": d.ghsClassification,
      "Received Date": d.receivedDate,
      "Status": d.processingStatus,
      "File Name": d.fileName
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "SDS Compliance Data");
    XLSX.writeFile(wb, "Dow_Chemical_SDS_Compliance_Report.xlsx");
    addToast('success', 'Export Complete', 'SDS compliance report downloaded successfully.');
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'Processed':
        return 'badge success';
      case 'Failed':
        return 'badge failed';
      case 'Pending':
      default:
        return 'badge pending';
    }
  };

  return (
    <div className="page-content">
      {/* Banner */}
      <div className="compliance-banner-strip" style={{ background: '#E3F0FF', borderLeft: '4px solid #1565C0', padding: '12px 16px', borderRadius: '6px', marginBottom: '20px', fontSize: '13px', color: '#0D47A1', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertCircle size={16} />
          <span>Automated IMAP attachment scanner searches Gmail for SDS/MSDS PDF attachments, downloads them, and uses <strong>pdfplumber</strong> to auto-extract critical compliance metadata.</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            className="btn btn-secondary btn-sm"
            style={{ gap: '6px' }}
            onClick={handleDownloadExcel}
          >
            <FileDown size={14} />
            Export to Excel
          </button>
          <button 
            className="btn btn-primary btn-sm"
            style={{ gap: '6px' }}
            onClick={runInboxScan}
            disabled={isScanning}
          >
            <RefreshCw size={14} className={isScanning ? 'spin' : ''} />
            {isScanning ? 'Scanning...' : 'Scan Inbox Attachments'}
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="automation-grid" style={{ gridTemplateColumns: selectedDoc ? '1fr 400px' : '1fr' }}>
        
        {/* Document List */}
        <div>
          <div className="page-header-actions" style={{ marginBottom: '16px' }}>
            <div className="search-bar-wrapper">
              <Search className="search-icon" size={18} />
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by vendor, product, or file..."
              />
            </div>

            <div className="filters-group">
              <select 
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', outline: 'none' }}
              >
                <option value="All">All Documents</option>
                <option value="Processed">Processed</option>
                <option value="Failed">Failed / Extraction Issues</option>
              </select>
            </div>
          </div>

          <div className="table-card">
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Vendor Name</th>
                    <th>Product / Title</th>
                    <th>File Name</th>
                    <th>Revision Date</th>
                    <th>Status</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="table-empty-state">
                        <FileText size={48} />
                        <h3>No SDS documents found</h3>
                        <p>Perform an inbox scan or upload files manually to process SDS documents.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredDocs.map((doc) => (
                      <tr key={doc.id} className={selectedDoc?.id === doc.id ? 'row-active' : ''} onClick={() => setSelectedDoc(doc)} style={{ cursor: 'pointer' }}>
                        <td><strong>{doc.vendorName}</strong></td>
                        <td>{doc.productName || 'N/A'}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{doc.fileName}</td>
                        <td>{doc.revisionDate || 'N/A'}</td>
                        <td>
                          <span className={getStatusBadgeClass(doc.processingStatus)}>
                            {doc.processingStatus}
                          </span>
                        </td>
                        <td className="text-right">
                          <button className="actions-cell-btn view-btn">
                            <Eye size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Selected Document Details Sidebar */}
        {selectedDoc && (
          <div className="automation-card" style={{ padding: '20px', borderLeft: '1px solid var(--border-color)', minHeight: 'calc(100vh - 160px)' }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '16px', margin: 0 }}>SDS Meta Details</h2>
              <button className="btn btn-ghost-sm" onClick={() => setSelectedDoc(null)} style={{ padding: '4px' }}>
                <X size={16} />
              </button>
            </div>

            <div className="sds-detail-section" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 'bold' }}>Vendor</label>
                <div style={{ fontSize: '14px', fontWeight: 'bold', marginTop: '2px' }}>{selectedDoc.vendorName}</div>
              </div>

              <div>
                <label style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 'bold' }}>Product Identifier</label>
                <div style={{ fontSize: '14px', marginTop: '2px', color: 'var(--text-dark)' }}>{selectedDoc.productName || 'N/A'}</div>
              </div>

              <div>
                <label style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 'bold' }}>Emergency Phone</label>
                <div style={{ fontSize: '14px', marginTop: '2px', color: 'var(--text-dark)' }}>{selectedDoc.emergencyPhone || 'N/A'}</div>
              </div>

              <div>
                <label style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 'bold' }}>Revision Date</label>
                <div style={{ fontSize: '14px', marginTop: '2px', color: 'var(--text-dark)' }}>{selectedDoc.revisionDate || 'N/A'}</div>
              </div>

              <div>
                <label style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 'bold' }}>GHS Classification Tags</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                  {selectedDoc.ghsClassification && selectedDoc.ghsClassification !== 'None Found' ? (
                    selectedDoc.ghsClassification.split(',').map((tag, i) => (
                      <span key={i} className="badge sent" style={{ fontSize: '10px' }}>{tag.trim()}</span>
                    ))
                  ) : (
                    <span className="badge pending" style={{ fontSize: '10px' }}>None Found / Safe</span>
                  )}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 'bold' }}>Source Document</label>
                <div style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-light)', marginTop: '2px' }}>{selectedDoc.fileName}</div>
              </div>

              {selectedDoc.processingStatus === 'Failed' && (
                <div style={{ background: '#FFF0F0', border: '1px solid #FFC1C1', padding: '12px', borderRadius: '6px', display: 'flex', gap: '8px', color: '#D32F2F', fontSize: '13px' }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <strong>Extraction/Compliance Error:</strong>
                    <div style={{ marginTop: '4px', fontSize: '12px', color: '#555' }}>
                      {selectedDoc.failureReason || 'Required section missing or revision date exceeds 3 year safety limit.'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Live extraction logs console */}
      {scanLogs.length > 0 && (
        <div className="automation-card" style={{ marginTop: '20px', padding: '16px' }}>
          <div className="logger-header" style={{ marginBottom: '12px' }}>
            <span>Real-time IMAP / PDF Extraction Log</span>
            <button className="logger-clear-btn" onClick={() => setScanLogs([])}>Clear</button>
          </div>
          <div className="logger-console" style={{ maxHeight: '180px' }}>
            {scanLogs.map((log, i) => (
              <div key={i} className={`log-line text-${log.type}`}>
                [{log.time}] {log.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
