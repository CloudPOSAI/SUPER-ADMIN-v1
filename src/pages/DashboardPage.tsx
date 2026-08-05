import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import ExtendLicenseModal from '../components/ExtendLicenseModal';
import './DashboardPage.css';

interface Organization {
  id: string;
  legal_name: string;
  trade_name: string | null;
  country_code: string;
  status: string;
  license_status: string;
  license_starts_at: string;
  license_expires_at: string;
  license_grace_ends_at: string | null;
  created_at: string;
}

function daysUntilExpiry(expiresAt: string): number {
  const now = new Date();
  const expiry = new Date(expiresAt);
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getLicenseProgressPercent(startsAt: string, expiresAt: string): number {
  const start = new Date(startsAt).getTime();
  const end = new Date(expiresAt).getTime();
  const now = Date.now();
  const total = end - start;
  const elapsed = now - start;
  return Math.max(0, Math.min(100, ((total - elapsed) / total) * 100));
}

function getEffectiveLicenseStatus(org: Organization): 'active' | 'grace_period' | 'expired' | 'suspended' {
  if (org.status === 'suspended' || org.license_status === 'suspended') return 'suspended';

  const now = Date.now();
  const expiry = new Date(org.license_expires_at).getTime();
  const graceEnd = org.license_grace_ends_at
    ? new Date(org.license_grace_ends_at).getTime()
    : expiry + 30 * 24 * 60 * 60 * 1000;

  if (now > graceEnd) return 'expired';
  if (now > expiry) return 'grace_period';
  return 'active';
}

function getLicenseStatusClass(status: string, daysLeft: number): string {
  if (status === 'expired') return 'expired';
  if (status === 'grace_period') return 'grace';
  if (status === 'suspended') return 'suspended';
  if (daysLeft <= 7 && daysLeft > 0) return 'grace';
  return 'active';
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function DashboardPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [extendModalOrg, setExtendModalOrg] = useState<Organization | null>(null);

  useEffect(() => {
    fetchOrgs();
  }, []);

  async function fetchOrgs() {
    setLoading(true);
    const { data, error } = await supabase
      .from('organizations')
      .select('id, legal_name, trade_name, country_code, status, license_status, license_starts_at, license_expires_at, license_grace_ends_at, created_at')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setOrgs(data as Organization[]);
    }
    setLoading(false);
  }

  const totalOrgs = orgs.length;
  const activeOrgs = orgs.filter((o) => getEffectiveLicenseStatus(o) === 'active').length;
  const expiringOrgs = orgs.filter((o) => {
    const days = daysUntilExpiry(o.license_expires_at);
    return getEffectiveLicenseStatus(o) === 'active' && days <= 30 && days > 0;
  }).length;
  const expiredOrgs = orgs.filter((o) => {
    const st = getEffectiveLicenseStatus(o);
    return st === 'expired' || st === 'grace_period';
  }).length;

  return (
    <div className="dashboard-page">
      {/* Top Navigation */}
      <nav className="dashboard-nav">
        <div className="dashboard-nav-inner">
          <div className="nav-brand">
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
          <div className="nav-actions">
            <button id="nav-new-tenant" className="btn btn-primary" onClick={() => navigate('/onboard')}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
              New Tenant
            </button>
            <button id="nav-sign-out" className="btn btn-ghost" onClick={signOut}>Sign Out</button>
          </div>
        </div>
      </nav>

      <main className="page-container">
        {/* Page Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">Tenant Dashboard</h1>
            <p className="page-subtitle">Manage organizations, licenses, and onboarding</p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="stats-grid">
          <div className="glass-card stat-card" id="stat-total-tenants">
            <span className="stat-label">Total Tenants</span>
            <div className="stat-value">{totalOrgs}</div>
          </div>
          <div className="glass-card stat-card" id="stat-active-licenses">
            <span className="stat-label">Active Licenses</span>
            <div className="stat-value" style={{ color: 'var(--color-success)' }}>{activeOrgs}</div>
          </div>
          <div className="glass-card stat-card" id="stat-expiring-soon">
            <span className="stat-label">Expiring Soon</span>
            <div className="stat-value" style={{ color: 'var(--color-warning)' }}>{expiringOrgs}</div>
          </div>
          <div className="glass-card stat-card" id="stat-expired">
            <span className="stat-label">Expired / Grace</span>
            <div className="stat-value" style={{ color: 'var(--color-danger)' }}>{expiredOrgs}</div>
          </div>
        </div>

        {/* Tenant Table */}
        <div className="glass-card table-card">
          <div className="table-header">
            <h2 className="table-title">All Organizations</h2>
          </div>

          {loading ? (
            <div className="table-loading">
              <div className="spinner spinner-lg" />
            </div>
          ) : orgs.length === 0 ? (
            <div className="table-empty">
              <p>No organizations found. Onboard your first tenant!</p>
              <button className="btn btn-primary" onClick={() => navigate('/onboard')}>
                Start Onboarding
              </button>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table" id="tenants-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Country</th>
                    <th>License Status</th>
                    <th>License Timeline</th>
                    <th>Expires</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orgs.map((org) => {
                    const effectiveStatus = getEffectiveLicenseStatus(org);
                    const days = daysUntilExpiry(org.license_expires_at);
                    const statusClass = getLicenseStatusClass(effectiveStatus, days);
                    const progressPct = getLicenseProgressPercent(
                      org.license_starts_at,
                      org.license_expires_at
                    );
                    const progressClass = days <= 0 || effectiveStatus === 'expired' ? 'danger' : days <= 30 || effectiveStatus === 'grace_period' ? 'warning' : 'good';

                    return (
                      <tr key={org.id}>
                        <td>
                          <div className="org-name">{org.legal_name}</div>
                          {org.trade_name && org.trade_name !== org.legal_name && (
                            <div className="org-trade">{org.trade_name}</div>
                          )}
                        </td>
                        <td>
                          <span className="country-badge">{org.country_code}</span>
                        </td>
                        <td>
                          <span className={`pill pill-${statusClass}`}>
                            <span className="pill-dot" />
                            {effectiveStatus === 'grace_period' ? 'Grace Period' : effectiveStatus}
                          </span>
                        </td>
                        <td>
                          <div className="license-timeline">
                            <div className="progress-bar">
                              <div
                                className={`progress-fill ${progressClass}`}
                                style={{ width: `${Math.max(progressPct, 2)}%` }}
                              />
                            </div>
                            <span className="timeline-days">
                              {days > 0 ? `${days} days left` : `${Math.abs(days)} days overdue`}
                            </span>
                          </div>
                        </td>
                        <td className="date-cell">{formatDate(org.license_expires_at)}</td>
                        <td>
                          <div className="action-buttons">
                            <button
                              className="btn btn-sm btn-success"
                              onClick={() => setExtendModalOrg(org)}
                              title="Extend License 1 Year"
                            >
                              Extend
                            </button>
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => navigate(`/tenant/${org.id}`)}
                              title="View Details"
                            >
                              View
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Extend License Modal */}
      {extendModalOrg && (
        <ExtendLicenseModal
          org={extendModalOrg}
          onClose={() => setExtendModalOrg(null)}
          onSuccess={fetchOrgs}
        />
      )}
    </div>
  );
}
