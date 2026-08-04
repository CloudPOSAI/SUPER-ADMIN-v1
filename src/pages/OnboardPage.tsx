import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import './OnboardPage.css';

interface WizardData {
  /* Step 1: Tenant */
  legal_name: string;
  trade_name: string;
  country_code: string;
  license_duration_days: number;
  /* Step 2: Branch & Inventory */
  branch_name: string;
  branch_code: string;
  stock_location_code: string;
  stock_location_name: string;
  stock_location_kind: 'store' | 'warehouse';
  /* Step 3: User & Role */
  user_email: string;
  user_name: string;
  user_phone: string;
  user_password: string;
  member_type: 'owner' | 'staff' | 'partner' | 'investor' | 'auditor';
  role_name: string;
  /* Step 4: Hardware */
  terminal_code: string;
  terminal_device_type: string;
  printer_name: string;
  printer_type: 'receipt' | 'kitchen';
}

const INITIAL_DATA: WizardData = {
  legal_name: '',
  trade_name: '',
  country_code: 'AE',
  license_duration_days: 365,
  branch_name: '',
  branch_code: '',
  stock_location_code: '',
  stock_location_name: '',
  stock_location_kind: 'store',
  user_email: '',
  user_name: '',
  user_phone: '',
  user_password: '',
  member_type: 'owner',
  role_name: 'Owner',
  terminal_code: '',
  terminal_device_type: 'POS Desktop',
  printer_name: 'Receipt Printer',
  printer_type: 'receipt',
};

const STEPS = [
  { label: 'Tenant', icon: '🏢' },
  { label: 'Branch', icon: '📍' },
  { label: 'User', icon: '👤' },
  { label: 'Hardware', icon: '🖥️' },
  { label: 'Review', icon: '✅' },
];

export default function OnboardPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');

  function updateField<K extends keyof WizardData>(key: K, value: WizardData[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function next() {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  }

  function prev() {
    if (step > 0) setStep((s) => s - 1);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      // Call the onboard-tenant Edge Function (Supabase SDK automatically attaches session JWT)
      const { data: fnResult, error: fnError } = await supabase.functions.invoke(
        'onboard-tenant',
        { body: data }
      );

      if (fnError) {
        let errorMsg = fnError.message || 'Onboarding failed';
        if ('context' in fnError && fnError.context instanceof Response) {
          try {
            const body = await fnError.context.json();
            if (body.error) errorMsg = body.error;
          } catch {
            /* use default message */
          }
        }
        setError(errorMsg);
      } else if (fnResult?.error) {
        setError(fnResult.error);
      } else {
        setResult(fnResult);
        setStep(STEPS.length); // Move to success view
      }
    } catch (err) {
      setError((err as Error).message || 'Unexpected error');
    }
    setSubmitting(false);
  }

  // Success screen
  if (step === STEPS.length && result) {
    return (
      <div className="onboard-page">
        <div className="onboard-container glass-card">
          <div className="success-view">
            <div className="success-icon">🎉</div>
            <h2 className="success-title">Tenant Onboarded Successfully!</h2>
            <p className="success-subtitle">
              <strong>{data.legal_name}</strong> has been provisioned with a {data.license_duration_days}-day license.
            </p>

            <div className="credentials-card glass-card">
              <h4>Login Credentials</h4>
              <div className="credential-row">
                <span className="credential-label">Email:</span>
                <code className="credential-value">{data.user_email}</code>
              </div>
              <div className="credential-row">
                <span className="credential-label">Password:</span>
                <code className="credential-value">{data.user_password}</code>
              </div>
              <div className="credential-row">
                <span className="credential-label">Branch:</span>
                <code className="credential-value">{data.branch_name} ({data.branch_code})</code>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  navigator.clipboard.writeText(
                    `Email: ${data.user_email}\nPassword: ${data.user_password}\nBranch: ${data.branch_name} (${data.branch_code})`
                  );
                }}
              >
                📋 Copy to Clipboard
              </button>
            </div>

            <div className="success-actions">
              <button className="btn btn-primary" onClick={() => navigate('/')}>
                Back to Dashboard
              </button>
              <button className="btn btn-ghost" onClick={() => { setStep(0); setData(INITIAL_DATA); setResult(null); }}>
                Onboard Another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="onboard-page">
      <div className="onboard-container glass-card">
        {/* Header */}
        <div className="onboard-header">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            ← Dashboard
          </button>
          <h2 className="onboard-title">Onboard New Tenant</h2>
        </div>

        {/* Step Indicator */}
        <div className="step-indicator">
          {STEPS.map((s, i) => (
            <div key={s.label} style={{ display: 'contents' }}>
              <div
                className={`step-dot ${i < step ? 'completed' : i === step ? 'active' : ''}`}
                title={s.label}
              >
                {i < step ? '✓' : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`step-line ${i < step ? 'completed' : ''}`} />
              )}
            </div>
          ))}
        </div>
        <div className="step-labels">
          {STEPS.map((s, i) => (
            <span key={s.label} className={`step-label ${i === step ? 'active' : ''}`}>
              {s.icon} {s.label}
            </span>
          ))}
        </div>

        {/* Step Content */}
        <form className="wizard-form" onSubmit={step === STEPS.length - 1 ? handleSubmit : (e) => { e.preventDefault(); next(); }}>
          {/* Step 1: Tenant Details */}
          {step === 0 && (
            <div className="step-content" id="step-tenant-details">
              <h3 className="step-heading">Tenant Details</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="legal_name">Legal Name <span className="required">*</span></label>
                  <input id="legal_name" className="form-input" value={data.legal_name} onChange={(e) => updateField('legal_name', e.target.value)} placeholder="Global Food Corporation LLC" required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="trade_name">Trade Name</label>
                  <input id="trade_name" className="form-input" value={data.trade_name} onChange={(e) => updateField('trade_name', e.target.value)} placeholder="Downtown Cafe" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="country_code">Country Code</label>
                  <select id="country_code" className="form-select" value={data.country_code} onChange={(e) => updateField('country_code', e.target.value)}>
                    <option value="AE">AE - UAE</option>
                    <option value="SA">SA - Saudi Arabia</option>
                    <option value="QA">QA - Qatar</option>
                    <option value="BH">BH - Bahrain</option>
                    <option value="KW">KW - Kuwait</option>
                    <option value="OM">OM - Oman</option>
                    <option value="IN">IN - India</option>
                    <option value="US">US - United States</option>
                    <option value="GB">GB - United Kingdom</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="license_duration_days">License Duration (Days)</label>
                  <input id="license_duration_days" className="form-input" type="number" min="30" max="3650" value={data.license_duration_days} onChange={(e) => updateField('license_duration_days', Number(e.target.value))} />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Branch & Inventory */}
          {step === 1 && (
            <div className="step-content" id="step-branch-inventory">
              <h3 className="step-heading">Branch & Inventory</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="branch_name">Branch Name <span className="required">*</span></label>
                  <input id="branch_name" className="form-input" value={data.branch_name} onChange={(e) => updateField('branch_name', e.target.value)} placeholder="Dubai Mall Store" required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="branch_code">Branch Code <span className="required">*</span></label>
                  <input id="branch_code" className="form-input" value={data.branch_code} onChange={(e) => updateField('branch_code', e.target.value.toUpperCase())} placeholder="DMS" required maxLength={10} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="stock_location_code">Stock Location Code <span className="required">*</span></label>
                  <input id="stock_location_code" className="form-input" value={data.stock_location_code} onChange={(e) => updateField('stock_location_code', e.target.value.toUpperCase())} placeholder="DMS-ST-001" required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="stock_location_name">Stock Location Name</label>
                  <input id="stock_location_name" className="form-input" value={data.stock_location_name} onChange={(e) => updateField('stock_location_name', e.target.value)} placeholder="Main Branch Store" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="stock_location_kind">Kind</label>
                  <select id="stock_location_kind" className="form-select" value={data.stock_location_kind} onChange={(e) => updateField('stock_location_kind', e.target.value as 'store' | 'warehouse')}>
                    <option value="store">Store</option>
                    <option value="warehouse">Warehouse</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Initial User & Role */}
          {step === 2 && (
            <div className="step-content" id="step-user-role">
              <h3 className="step-heading">Initial User & Role</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="user_email">Email <span className="required">*</span></label>
                  <input id="user_email" className="form-input" type="email" value={data.user_email} onChange={(e) => updateField('user_email', e.target.value)} placeholder="owner@store.com" required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="user_name">Full Name <span className="required">*</span></label>
                  <input id="user_name" className="form-input" value={data.user_name} onChange={(e) => updateField('user_name', e.target.value)} placeholder="John Doe" required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="user_phone">Phone Number</label>
                  <input id="user_phone" className="form-input" type="tel" value={data.user_phone} onChange={(e) => updateField('user_phone', e.target.value)} placeholder="0501234567" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="user_password">Temporary Password <span className="required">*</span></label>
                  <input id="user_password" className="form-input" type="text" value={data.user_password} onChange={(e) => updateField('user_password', e.target.value)} placeholder="StrongP@ss2026" required minLength={8} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="member_type">Member Type</label>
                  <select id="member_type" className="form-select" value={data.member_type} onChange={(e) => updateField('member_type', e.target.value as WizardData['member_type'])}>
                    <option value="owner">Owner</option>
                    <option value="staff">Staff</option>
                    <option value="partner">Partner</option>
                    <option value="investor">Investor</option>
                    <option value="auditor">Auditor</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="role_name">App Role</label>
                  <select id="role_name" className="form-select" value={data.role_name} onChange={(e) => updateField('role_name', e.target.value)}>
                    <option value="Owner">Owner (Level 999)</option>
                    <option value="Admin">Admin (Level 100)</option>
                    <option value="Manager">Manager (Level 50)</option>
                    <option value="Cashier">Cashier (Level 10)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Terminal & Printer */}
          {step === 3 && (
            <div className="step-content" id="step-hardware-config">
              <h3 className="step-heading">Terminal & Printer</h3>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="terminal_code">Terminal Code <span className="required">*</span></label>
                  <input id="terminal_code" className="form-input" value={data.terminal_code} onChange={(e) => updateField('terminal_code', e.target.value.toUpperCase())} placeholder="TERM-01" required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="terminal_device_type">Device Type</label>
                  <input id="terminal_device_type" className="form-input" value={data.terminal_device_type} onChange={(e) => updateField('terminal_device_type', e.target.value)} placeholder="POS Desktop" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="printer_name">Printer Name</label>
                  <input id="printer_name" className="form-input" value={data.printer_name} onChange={(e) => updateField('printer_name', e.target.value)} placeholder="Receipt Printer" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="printer_type">Printer Type</label>
                  <select id="printer_type" className="form-select" value={data.printer_type} onChange={(e) => updateField('printer_type', e.target.value as 'receipt' | 'kitchen')}>
                    <option value="receipt">Receipt</option>
                    <option value="kitchen">Kitchen</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Step 5: Review */}
          {step === 4 && (
            <div className="step-content" id="step-review">
              <h3 className="step-heading">Review & Provision</h3>
              <div className="review-grid">
                <div className="review-section">
                  <h4>🏢 Tenant</h4>
                  <div className="review-row"><span>Legal Name:</span><strong>{data.legal_name}</strong></div>
                  <div className="review-row"><span>Trade Name:</span><strong>{data.trade_name || data.legal_name}</strong></div>
                  <div className="review-row"><span>Country:</span><strong>{data.country_code}</strong></div>
                  <div className="review-row"><span>License:</span><strong>{data.license_duration_days} days</strong></div>
                </div>
                <div className="review-section">
                  <h4>📍 Branch & Inventory</h4>
                  <div className="review-row"><span>Branch:</span><strong>{data.branch_name} ({data.branch_code})</strong></div>
                  <div className="review-row"><span>Stock Location:</span><strong>{data.stock_location_code}</strong></div>
                  <div className="review-row"><span>Kind:</span><strong>{data.stock_location_kind}</strong></div>
                </div>
                <div className="review-section">
                  <h4>👤 Initial User</h4>
                  <div className="review-row"><span>Email:</span><strong>{data.user_email}</strong></div>
                  <div className="review-row"><span>Name:</span><strong>{data.user_name}</strong></div>
                  <div className="review-row"><span>Member Type:</span><strong>{data.member_type}</strong></div>
                  <div className="review-row"><span>Role:</span><strong>{data.role_name}</strong></div>
                </div>
                <div className="review-section">
                  <h4>🖥️ Hardware</h4>
                  <div className="review-row"><span>Terminal:</span><strong>{data.terminal_code} ({data.terminal_device_type})</strong></div>
                  <div className="review-row"><span>Printer:</span><strong>{data.printer_name} ({data.printer_type})</strong></div>
                </div>
              </div>
            </div>
          )}

          {error && <div className="form-error wizard-error">{error}</div>}

          {/* Navigation Buttons */}
          <div className="wizard-nav">
            <button type="button" className="btn btn-ghost" onClick={step === 0 ? () => navigate('/') : prev} disabled={submitting}>
              {step === 0 ? 'Cancel' : '← Back'}
            </button>
            <button
              type="submit"
              className={`btn ${step === STEPS.length - 1 ? 'btn-success btn-lg' : 'btn-primary'}`}
              disabled={submitting}
              id={step === STEPS.length - 1 ? 'provision-tenant' : 'wizard-next'}
            >
              {submitting && <span className="spinner" />}
              {step === STEPS.length - 1
                ? submitting ? 'Provisioning...' : '🚀 Provision Tenant'
                : 'Next →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
