import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import './ExtendLicenseModal.css';

interface OrganizationLicenseInfo {
  id: string;
  legal_name: string;
  license_status: string;
  license_starts_at: string;
  license_expires_at: string;
}

interface ExtendLicenseModalProps {
  org: OrganizationLicenseInfo;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ExtendLicenseModal({
  org,
  onClose,
  onSuccess,
}: ExtendLicenseModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Default preset: +1 Year from now
  const defaultTargetDate = new Date();
  defaultTargetDate.setFullYear(defaultTargetDate.getFullYear() + 1);

  const [preset, setPreset] = useState<'30' | '90' | '180' | '365' | 'custom'>('365');
  const [customDate, setCustomDate] = useState<string>(
    defaultTargetDate.toISOString().split('T')[0]
  );
  const [resetStartDate, setResetStartDate] = useState(true);

  const handlePresetChange = (selectedPreset: '30' | '90' | '180' | '365') => {
    setPreset(selectedPreset);
    const baseDate = resetStartDate ? new Date() : new Date(org.license_expires_at);
    const target = new Date(baseDate);
    const days = parseInt(selectedPreset, 10);
    target.setDate(target.getDate() + days);
    setCustomDate(target.toISOString().split('T')[0]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const targetExpiry = new Date(`${customDate}T23:59:59Z`);
      if (isNaN(targetExpiry.getTime())) {
        throw new Error('Please select a valid expiration date.');
      }

      const startsAt = resetStartDate ? new Date().toISOString() : org.license_starts_at;
      const expiresAt = targetExpiry.toISOString();
      const graceEndsAt = new Date(targetExpiry.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // 1. Update organization license columns
      const { error: orgErr } = await supabase
        .from('organizations')
        .update({
          license_status: 'active',
          license_starts_at: startsAt,
          license_expires_at: expiresAt,
          license_grace_ends_at: graceEndsAt,
        })
        .eq('id', org.id);

      if (orgErr) throw orgErr;

      // 2. Update current_period_end in subscriptions
      await supabase
        .from('subscriptions')
        .update({
          status: 'active',
          current_period_end: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('organization_id', org.id);

      onSuccess();
      onClose();
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error('Error extending license:', e);
      setError(e.message || 'Failed to extend license');
    } finally {
      setLoading(false);
    }
  };

  const currentExpiryFormatted = new Date(org.license_expires_at).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-card extend-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Extend Tenant License</h2>
            <p className="modal-subtitle">Organization: <strong>{org.legal_name}</strong></p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="form-error">{error}</div>}

          <div className="current-status-banner">
            <div>
              <span className="banner-label">Current Expiry:</span>
              <strong className="banner-value">{currentExpiryFormatted}</strong>
            </div>
            <span className={`pill pill-${org.license_status === 'active' ? 'active' : 'grace'}`}>
              {org.license_status}
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">Duration Quick Presets</label>
            <div className="preset-buttons">
              <button
                type="button"
                className={`preset-btn ${preset === '30' ? 'active' : ''}`}
                onClick={() => handlePresetChange('30')}
              >
                +30 Days
                <span className="preset-sub">(1 Month)</span>
              </button>
              <button
                type="button"
                className={`preset-btn ${preset === '90' ? 'active' : ''}`}
                onClick={() => handlePresetChange('90')}
              >
                +90 Days
                <span className="preset-sub">(3 Months)</span>
              </button>
              <button
                type="button"
                className={`preset-btn ${preset === '180' ? 'active' : ''}`}
                onClick={() => handlePresetChange('180')}
              >
                +180 Days
                <span className="preset-sub">(6 Months)</span>
              </button>
              <button
                type="button"
                className={`preset-btn ${preset === '365' ? 'active' : ''}`}
                onClick={() => handlePresetChange('365')}
              >
                +365 Days
                <span className="preset-sub">(1 Year)</span>
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">New Expiration Date</label>
            <input
              type="date"
              className="form-input custom-date-input"
              value={customDate}
              onChange={(e) => {
                setCustomDate(e.target.value);
                setPreset('custom');
              }}
              required
            />
          </div>

          <div className="form-group-checkbox">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={resetStartDate}
                onChange={(e) => setResetStartDate(e.target.checked)}
              />
              Reset License Start Date to Today
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : null}
              {loading ? 'Extending...' : 'Confirm Extension'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
