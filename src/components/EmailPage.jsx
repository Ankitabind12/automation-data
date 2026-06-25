import React, { useState, useRef } from 'react';
import { Save, Send, Trash2, MailPlus, AlertCircle } from 'lucide-react';

export default function EmailPage({
  vendors,
  addNotification,
  addToast,
  requestsSent,
  setRequestsSent,
  successSent,
  setSuccessSent,
  failedSent,
  setFailedSent,
  setLastRequestDate,
  onLogActivity,
  emailTemplate,
  setEmailTemplate,
  setVendors
}) {
  const [subject, setSubject] = useState('Action Required: Submit Updated SDS/MSDS Documentation – Dow Chemical');
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStatus, setProgressStatus] = useState('Initializing mail servers...');
  const [consoleLogs, setConsoleLogs] = useState([
    { id: 1, text: '[2026-06-24 10:00:00] Initialized Dow Compliance automation scheduler.', type: 'muted' },
    { id: 2, text: '[2026-06-24 10:00:02] Connected to SMTP secure relay service.', type: 'success' },
    { id: 3, text: '[2026-06-24 10:00:05] Idle - waiting for user execution trigger.', type: '' }
  ]);

  const textareaRef = useRef(null);

  const insertPlaceholder = (tag) => {
    if (!textareaRef.current) return;
    const txt = emailTemplate;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    const inserted = txt.substring(0, start) + tag + txt.substring(end);
    setEmailTemplate(inserted);
    
    setTimeout(() => {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = start + tag.length;
      textareaRef.current.selectionEnd = start + tag.length;
    }, 10);
  };

  const handleSaveDraft = () => {
    addToast('success', 'Draft Saved', 'SDS Request Template draft saved successfully.');
  };

  const clearLogs = () => {
    setConsoleLogs([]);
  };

  const runEmailCampaign = async () => {
    if (isSending) return;

    if (vendors.length === 0) {
      addToast('info', 'No Vendors', 'There are no vendors registered in the directory.');
      return;
    }

    setIsSending(true);
    setProgress(10);
    setProgressStatus('Connecting to Dow SMTP server...');
    setConsoleLogs(p => [...p, { id: Date.now(), text: `[${new Date().toLocaleTimeString()}] Triggering compliance campaign for ${vendors.length} vendors...`, type: 'info' }]);

    try {
      const response = await fetch('http://localhost:4000/send-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendors,
          subject,
          body: emailTemplate,
        }),
      });

      setProgress(50);
      setProgressStatus('Processing emails...');

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Server error');

      const results = data.results || [];
      const sentCount = results.length;
      const successCount = results.filter(r => r.status === 'sent').length;
      const failedCount = sentCount - successCount;

      setRequestsSent(prev => prev + sentCount);
      setSuccessSent(prev => prev + successCount);
      setFailedSent(prev => prev + failedCount);

      const today = new Date().toISOString().split('T')[0];
      setLastRequestDate(today);

      // Update vendors requestDate & status
      setVendors(prev => prev.map(v => {
        const matchingResult = results.find(r => r.vendor === v.email);
        if (matchingResult) {
          const updatedVendor = {
            ...v,
            requestDate: today,
            status: matchingResult.status === 'sent' ? 'Requested' : 'Failed',
            complianceStatus: matchingResult.status === 'sent' ? 'Pending' : 'Non-Compliant'
          };
          
          // Persist to database so it doesn't vanish on refresh
          fetch('http://localhost:4000/vendors', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedVendor)
          }).catch(err => console.error('Failed to save vendor status', err));

          return updatedVendor;
        }
        return v;
      }));

      // Log activity
      results.forEach(r => {
        const logText = `[${new Date().toLocaleTimeString()}] Email status to ${r.name} (${r.vendor}): ${r.status.toUpperCase()}`;
        setConsoleLogs(p => [...p, { id: Date.now() + Math.random(), text: logText, type: r.status === 'sent' ? 'success' : 'danger' }]);
        
        onLogActivity(
          r.name,
          today,
          null,
          r.status === 'sent' ? 'Requested' : 'Failed',
          r.status === 'sent' ? 'Pending' : 'Non-Compliant'
        );

        if (r.status !== 'sent') {
          addNotification('warning', `SDS email delivery failed to <strong>${r.name}</strong>.`);
        } else {
          addNotification('success', `SDS compliance request sent to <strong>${r.name}</strong>.`);
        }
      });

      if (failedCount > 0) {
        addToast('warning', 'Campaign Finished with Errors', `${successCount} succeeded, ${failedCount} failed.`);
      } else {
        addToast('success', 'Campaign Successful', `Dispatched ${successCount} branded SDS compliance emails.`);
      }
    } catch (err) {
      console.error('Email campaign error', err);
      addToast('danger', 'Campaign Failed', err.message);
      addNotification('warning', `Campaign Error: ${err.message}`);
      setConsoleLogs(p => [...p, { id: Date.now(), text: `[ERROR] ${err.message}`, type: 'danger' }]);
    } finally {
      setIsSending(false);
      setProgress(100);
      setProgressStatus('Finished');
    }
  };

  return (
    <div className="page-content">
      {/* Informative notice */}
      <div className="compliance-banner-strip" style={{ background: '#E3F0FF', borderLeft: '4px solid #1565C0', padding: '12px 16px', borderRadius: '6px', marginBottom: '20px', fontSize: '13px', color: '#0D47A1', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <AlertCircle size={16} />
        <span>Emails sent through this page are beautifully formatted using the <strong>Dow Chemical corporate branding template</strong>. All external upload portals are removed; vendors simply reply directly to request emails.</span>
      </div>

      <div className="automation-grid">
        
        {/* Email Template Configuration Form */}
        <div className="automation-card template-config">
          <div className="card-header">
            <h2>SDS Request Template</h2>
            <span className="card-subtitle">Draft the automated email template sent to vendors.</span>
          </div>
          <form className="template-form" onSubmit={(e) => e.preventDefault()}>
            <div className="form-group">
              <label htmlFor="email-subject">Email Subject</label>
              <input 
                type="text" 
                id="email-subject" 
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={isSending}
                placeholder="Subject for compliance campaign..."
              />
            </div>

            <div className="form-group">
              <label htmlFor="email-message-template">Email Message Template (Fallback Plain-Text)</label>
              <div className="template-placeholders">
                <button 
                  type="button" 
                  className="placeholder-tag" 
                  onClick={() => insertPlaceholder('{vendor_name}')}
                  disabled={isSending}
                >
                  {'{vendor_name}'}
                </button>
                <button 
                  type="button" 
                  className="placeholder-tag" 
                  onClick={() => insertPlaceholder('{contact_person}')}
                  disabled={isSending}
                >
                  {'{contact_person}'}
                </button>
              </div>
              
              <textarea 
                id="email-message-template" 
                ref={textareaRef}
                rows={14} 
                value={emailTemplate}
                onChange={(e) => setEmailTemplate(e.target.value)}
                disabled={isSending}
                placeholder="Write fallback plain-text email body here..."
              />
            </div>

            <div className="form-actions">
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={handleSaveDraft}
                disabled={isSending}
              >
                <Save size={16} /> Save Template Draft
              </button>
            </div>
          </form>
        </div>

        {/* Email Campaign Control & Status */}
        <div className="automation-card campaign-control">
          <div className="card-header">
            <h2>Campaign Controller</h2>
            <span className="card-subtitle">Manage, trigger, and view real-time email dispatch campaigns.</span>
          </div>

          {/* Live Stat Panels */}
          <div className="automation-stats-row">
            <div className="stat-box blue">
              <span className="stat-number" id="auto-total-sent">{requestsSent}</span>
              <span className="stat-label">Total Sent</span>
            </div>
            <div className="stat-box green">
              <span className="stat-number" id="auto-success-sent">{successSent}</span>
              <span className="stat-label">Successful</span>
            </div>
            <div className="stat-box red">
              <span className="stat-number" id="auto-failed-sent">{failedSent}</span>
              <span className="stat-label">Failed</span>
            </div>
          </div>

          {/* Send Button & Progress Area */}
          <div className="run-campaign-box">
            <button 
              className="btn btn-primary btn-large btn-full" 
              onClick={runEmailCampaign}
              disabled={isSending}
            >
              <Send size={16} />
              <span>{isSending ? 'Sending in Progress...' : 'Dispatch SDS Request Campaign'}</span>
            </button>

            {/* Sending Progress Bar */}
            {isSending && (
              <div className="sending-progress-container" id="campaign-progress-wrapper">
                <div className="progress-info">
                  <span className="progress-status" id="campaign-progress-status">{progressStatus}</span>
                  <span className="progress-percent" id="campaign-progress-percent">{progress}%</span>
                </div>
                <div className="progress-bar-track">
                  <div 
                    className="progress-bar-fill" 
                    id="campaign-progress-fill"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          {/* Live Execution Logger */}
          <div className="logger-box">
            <div className="logger-header">
              <span>Automation Console Output</span>
              <button 
                className="logger-clear-btn" 
                onClick={clearLogs}
              >
                <Trash2 size={12} /> Clear Logs
              </button>
            </div>
            <div className="logger-console" id="console-output-logs">
              {consoleLogs.map((log) => (
                <div key={log.id} className={`log-line ${log.type ? `text-${log.type}` : ''}`}>
                  {log.text}
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
