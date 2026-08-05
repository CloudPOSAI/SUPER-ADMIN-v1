import { useState, useEffect, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { type PlanRecord } from './PlanModal';
import './ChangePlanModal.css';

interface ChangePlanModalProps {
  orgId: string;
  orgName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ChangePlanModal({
  orgId,
  orgName,
  onClose,
  onSuccess,
}: ChangePlanModalProps) {
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [recalculateExpiry, setRecalculateExpiry] = useState<boolean>(true);

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetchPlanContext();
  }, [orgId]);

  async function fetchPlanContext() {
    setLoading(true);
    try {
      // 1. Fetch available plans
      const { data: plansData } = await supabase
        .from('plans')
        .select('*')
        .eq('is_active', true)
        .order('price_monthly', { ascending: true });

      if (plansData) {
        setPlans(plansData as PlanRecord[]);
      }

      // 2. Fetch active subscription for this tenant
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('plan_id')
        .eq('organization_id', orgId)
        .maybeSingle();

      if (subData?.plan_id) {
        setCurrentPlanId(subData.plan_id);
        setSelectedPlanId(subData.plan_id);
      } else if (plansData && plansData.length > 0) {
        setSelectedPlanId(plansData[0].id);
      }
    } catch (err: unknown) {
      console.error('Error fetching plan context:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      if (!selectedPlanId) {
        throw new Error('Please select a plan.');
      }

      const selectedPlan = plans.find((p) => p.id === selectedPlanId);
      const now = new Date();

      // 1. Upsert subscription record
      const { error: subErr } = await supabase
        .from('subscriptions')
        .upsert(
          {
            organization_id: orgId,
            plan_id: selectedPlanId,
            status: 'active',
            updated_at: now.toISOString(),
          },
          { onConflict: 'organization_id' }
        );

      if (subErr) throw subErr;

      // 2. Optional expiry recalculation based on plan duration
      if (recalculateExpiry && selectedPlan?.features?.license_duration_days) {
        const durationDays = selectedPlan.features.license_duration_days;
        const newExpiry = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
        const graceEnd = new Date(newExpiry.getTime() + 30 * 24 * 60 * 60 * 1000);

        await supabase
          .from('organizations')
          .update({
            license_status: 'active',
            license_starts_at: now.toISOString(),
            license_expires_at: newExpiry.toISOString(),
            license_grace_ends_at: graceEnd.toISOString(),
          })
          .eq('id', orgId);

        await supabase
          .from('subscriptions')
          .update({ current_period_end: newExpiry.toISOString() })
          .eq('organization_id', orgId);
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error('Error changing plan:', e);
      setError(e.message || 'Failed to change plan');
    } finally {
      setSaving(false);
    }
  };

  const selectedPlanObj = plans.find((p) => p.id === selectedPlanId);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-card change-plan-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Change Tenant Plan</h2>
            <p className="modal-subtitle">Organization: <strong>{orgName}</strong></p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {loading ? (
          <div className="modal-loading">
            <div className="spinner spinner-lg" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="modal-form">
            {error && <div className="form-error">{error}</div>}

            <div className="form-group">
              <label className="form-label">Select Commercial Plan Tier <span className="required">*</span></label>
              <select
                className="form-select"
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                required
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ${p.price_monthly}/mo ({p.features?.license_duration_days || 365} days) {p.id === currentPlanId ? '⭐ Current Plan' : ''}
                  </option>
                ))}
              </select>
            </div>

            {selectedPlanObj && (
              <div className="plan-preview-box">
                <div className="preview-header">
                  <strong>{selectedPlanObj.name}</strong>
                  <span className="preview-price">${selectedPlanObj.price_monthly}/mo</span>
                </div>
                <div className="preview-features">
                  <span>🏢 Max Branches: <strong>{selectedPlanObj.features?.max_branches ?? 'Unlimited'}</strong></span>
                  <span>🖥️ Max Terminals: <strong>{selectedPlanObj.features?.max_terminals ?? 'Unlimited'}</strong></span>
                  <span>👤 Max Members: <strong>{selectedPlanObj.features?.max_users ?? 'Unlimited'}</strong></span>
                </div>
              </div>
            )}

            <div className="form-group-checkbox" style={{ marginTop: 'var(--space-4)' }}>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={recalculateExpiry}
                  onChange={(e) => setRecalculateExpiry(e.target.checked)}
                />
                Reset license duration from today ({selectedPlanObj?.features?.license_duration_days || 365} days)
              </label>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <span className="spinner" /> : null}
                {saving ? 'Updating...' : 'Confirm Plan Change'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
