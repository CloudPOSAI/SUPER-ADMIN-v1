import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import './PlanModal.css';

export interface PlanRecord {
  id: string;
  name: string;
  code: string;
  price_monthly: number | string;
  is_active: boolean;
  features: {
    includes?: string[];
    max_branches?: number;
    max_terminals?: number;
    max_users?: number;
    license_duration_days?: number;
  };
}

interface PlanModalProps {
  plan?: PlanRecord | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function PlanModal({ plan, onClose, onSuccess }: PlanModalProps) {
  const isEdit = Boolean(plan);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState(plan?.name || '');
  const [code, setCode] = useState(plan?.code || '');
  const [priceMonthly, setPriceMonthly] = useState<number | string>(plan?.price_monthly ?? 99);
  const [isActive, setIsActive] = useState<boolean>(plan?.is_active ?? true);

  const [durationDays, setDurationDays] = useState<number>(
    plan?.features?.license_duration_days ?? 365
  );
  const [maxBranches, setMaxBranches] = useState<number>(plan?.features?.max_branches ?? 5);
  const [maxTerminals, setMaxTerminals] = useState<number>(plan?.features?.max_terminals ?? 2);
  const [maxUsers, setMaxUsers] = useState<number>(plan?.features?.max_users ?? 10);

  const includesList = plan?.features?.includes || ['pos', 'admin'];
  const [hasPos, setHasPos] = useState(includesList.includes('pos'));
  const [hasAdmin, setHasAdmin] = useState(includesList.includes('admin'));
  const [hasIms, setHasIms] = useState(includesList.includes('ims'));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const includes: string[] = [];
      if (hasPos) includes.push('pos');
      if (hasAdmin) includes.push('admin');
      if (hasIms) includes.push('ims');

      const featuresObj = {
        includes,
        max_branches: Number(maxBranches),
        max_terminals: Number(maxTerminals),
        max_users: Number(maxUsers),
        license_duration_days: Number(durationDays),
      };

      const payload = {
        name: name.trim(),
        code: code.trim().toLowerCase().replace(/\s+/g, '_'),
        price_monthly: Number(priceMonthly),
        is_active: isActive,
        features: featuresObj,
      };

      if (isEdit && plan) {
        const { error: err } = await supabase
          .from('plans')
          .update(payload)
          .eq('id', plan.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase
          .from('plans')
          .insert(payload);
        if (err) throw err;
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error('Error saving plan:', e);
      setError(e.message || 'Failed to save plan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-card plan-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{isEdit ? 'Edit Subscription Plan' : 'Create Subscription Plan'}</h2>
            <p className="modal-subtitle">Define pricing, duration, quotas, and module access</p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Plan Name <span className="required">*</span></label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Enterprise Annual"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!isEdit) setCode(e.target.value.toLowerCase().replace(/\s+/g, '_'));
                }}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Plan Code <span className="required">*</span></label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. enterprise_annual"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Monthly Price ($/AED) <span className="required">*</span></label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="form-input"
                value={priceMonthly}
                onChange={(e) => setPriceMonthly(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">License Duration (Days) <span className="required">*</span></label>
              <select
                className="form-select"
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
              >
                <option value={30}>30 Days (1 Month)</option>
                <option value={90}>90 Days (3 Months)</option>
                <option value={180}>180 Days (6 Months)</option>
                <option value={365}>365 Days (1 Year)</option>
              </select>
            </div>
          </div>

          <div className="form-section-title">Resource Quotas & Limits</div>
          <div className="form-grid-3">
            <div className="form-group">
              <label className="form-label">Max Branches</label>
              <input
                type="number"
                min="1"
                className="form-input"
                value={maxBranches}
                onChange={(e) => setMaxBranches(Number(e.target.value))}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Max POS Terminals</label>
              <input
                type="number"
                min="1"
                className="form-input"
                value={maxTerminals}
                onChange={(e) => setMaxTerminals(Number(e.target.value))}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Max Members</label>
              <input
                type="number"
                min="1"
                className="form-input"
                value={maxUsers}
                onChange={(e) => setMaxUsers(Number(e.target.value))}
                required
              />
            </div>
          </div>

          <div className="form-section-title">Included Apps & Modules</div>
          <div className="module-checkbox-grid">
            <label className="checkbox-label card-checkbox">
              <input
                type="checkbox"
                checked={hasPos}
                onChange={(e) => setHasPos(e.target.checked)}
              />
              🖥️ POS Billing App
            </label>
            <label className="checkbox-label card-checkbox">
              <input
                type="checkbox"
                checked={hasAdmin}
                onChange={(e) => setHasAdmin(e.target.checked)}
              />
              🏢 Backoffice Portal
            </label>
            <label className="checkbox-label card-checkbox">
              <input
                type="checkbox"
                checked={hasIms}
                onChange={(e) => setHasIms(e.target.checked)}
              />
              📦 IMS Inventory App
            </label>
          </div>

          <div className="form-group-checkbox" style={{ marginTop: 'var(--space-4)' }}>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Plan is Active (Available for Onboarding)
            </label>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : null}
              {loading ? 'Saving...' : isEdit ? 'Save Plan Changes' : 'Create Plan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
