import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import PlanModal, { type PlanRecord } from '../components/PlanModal';
import './PlansPage.css';

export default function PlansPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPlan, setEditingPlan] = useState<PlanRecord | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  useEffect(() => {
    fetchPlans();
  }, []);

  async function fetchPlans() {
    setLoading(true);
    const { data, error } = await supabase
      .from('plans')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setPlans(data as PlanRecord[]);
    }
    setLoading(false);
  }

  async function togglePlanStatus(plan: PlanRecord) {
    const { error } = await supabase
      .from('plans')
      .update({ is_active: !plan.is_active })
      .eq('id', plan.id);

    if (!error) {
      fetchPlans();
    }
  }

  return (
    <div className="plans-page">
      {/* Top Navigation */}
      <nav className="dashboard-nav">
        <div className="dashboard-nav-inner">
          <div className="nav-brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
            <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="10" fill="url(#nav-logo)" />
              <path d="M12 20L18 26L28 14" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <defs>
                <linearGradient id="nav-logo" x1="0" y1="0" x2="40" y2="40">
                  <stop stopColor="#6366f1" />
                  <stop offset="1" stopColor="#a78bfa" />
                </linearGradient>
              </defs>
            </svg>
            <span className="nav-brand-text">CloudPOS <span className="nav-brand-accent">Super Admin</span></span>
          </div>

          <div className="nav-links">
            <button className="nav-link-btn" onClick={() => navigate('/')}>Tenants</button>
            <button className="nav-link-btn active" onClick={() => navigate('/plans')}>Plans</button>
          </div>

          <div className="nav-actions">
            <button className="btn btn-primary" onClick={() => setIsAddModalOpen(true)}>
              + Create Plan
            </button>
            <button className="btn btn-ghost" onClick={signOut}>Sign Out</button>
          </div>
        </div>
      </nav>

      <main className="page-container">
        {/* Page Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">Subscription Plans</h1>
            <p className="page-subtitle">Configure commercial tiers, quotas, duration, and feature sets</p>
          </div>
        </div>

        {loading ? (
          <div className="loading-screen" style={{ minHeight: '300px' }}>
            <div className="spinner spinner-lg" />
          </div>
        ) : plans.length === 0 ? (
          <div className="glass-card plan-empty-card">
            <p>No subscription plans found. Create your first pricing tier!</p>
            <button className="btn btn-primary" onClick={() => setIsAddModalOpen(true)}>
              + Create First Plan
            </button>
          </div>
        ) : (
          <div className="plans-grid">
            {plans.map((plan) => {
              const duration = plan.features?.license_duration_days || 365;
              const includes = plan.features?.includes || [];
              const maxBranches = plan.features?.max_branches ?? 'Unlimited';
              const maxTerminals = plan.features?.max_terminals ?? 'Unlimited';
              const maxUsers = plan.features?.max_users ?? 'Unlimited';

              return (
                <div key={plan.id} className={`glass-card plan-card ${!plan.is_active ? 'plan-inactive' : ''}`}>
                  <div className="plan-card-header">
                    <div>
                      <h3 className="plan-name">{plan.name}</h3>
                      <div className="plan-code">{plan.code}</div>
                    </div>
                    <span className={`pill pill-${plan.is_active ? 'active' : 'suspended'}`}>
                      {plan.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div className="plan-price-row">
                    <span className="plan-price">${plan.price_monthly}</span>
                    <span className="plan-price-period">/ month ({duration} days duration)</span>
                  </div>

                  <div className="plan-specs">
                    <div className="spec-item">
                      <span>🏢 Max Branches</span>
                      <strong>{maxBranches}</strong>
                    </div>
                    <div className="spec-item">
                      <span>🖥️ Max Terminals</span>
                      <strong>{maxTerminals}</strong>
                    </div>
                    <div className="spec-item">
                      <span>👤 Max Members</span>
                      <strong>{maxUsers}</strong>
                    </div>
                  </div>

                  <div className="plan-modules">
                    <span className="module-label">Included Modules:</span>
                    <div className="module-badges">
                      {includes.map((mod) => (
                        <span key={mod} className="module-badge">
                          {mod === 'pos' ? '🖥️ POS' : mod === 'admin' ? '🏢 Backoffice' : '📦 IMS'}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="plan-card-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditingPlan(plan)}>
                      Edit Plan
                    </button>
                    <button
                      className={`btn btn-sm ${plan.is_active ? 'btn-ghost' : 'btn-success'}`}
                      onClick={() => togglePlanStatus(plan)}
                    >
                      {plan.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {(isAddModalOpen || editingPlan) && (
        <PlanModal
          plan={editingPlan}
          onClose={() => {
            setIsAddModalOpen(false);
            setEditingPlan(null);
          }}
          onSuccess={fetchPlans}
        />
      )}
    </div>
  );
}
