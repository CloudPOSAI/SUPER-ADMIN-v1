import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import './TenantDetailPage.css';

interface Organization {
  id: string;
  legal_name: string;
  trade_name: string | null;
  country_code: string;
  status: string;
  license_status: string;
  license_starts_at: string;
  license_expires_at: string;
  created_at: string;
}

interface Branch {
  id: string;
  name: string;
  branch_code: string;
  status: string;
}

interface MemberRow {
  user_id: string;
  member_type: string;
  status: string;
  users: { email: string; name: string } | null;
  app_roles: { name: string; level: number } | null;
}

export default function TenantDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [org, setOrg] = useState<Organization | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orgId) fetchAll();
  }, [orgId]);

  async function fetchAll() {
    setLoading(true);

    const [orgRes, branchRes, memberRes] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', orgId!).single(),
      supabase.from('branches').select('id, name, branch_code, status').eq('organization_id', orgId!),
      supabase.from('organization_memberships')
        .select('user_id, member_type, status, users(email, name), app_roles:role_id(name, level)')
        .eq('organization_id', orgId!),
    ]);

    if (orgRes.data) setOrg(orgRes.data as Organization);
    if (branchRes.data) setBranches(branchRes.data as Branch[]);
    if (memberRes.data) setMembers(memberRes.data as unknown as MemberRow[]);
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg" />
        <span style={{ color: 'var(--color-text-muted)' }}>Loading tenant details...</span>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="loading-screen">
        <p>Organization not found.</p>
        <button className="btn btn-ghost" onClick={() => navigate('/')}>Back to Dashboard</button>
      </div>
    );
  }

  const statusClass =
    org.license_status === 'active' ? 'active'
    : org.license_status === 'grace_period' ? 'grace'
    : org.license_status === 'expired' ? 'expired'
    : 'suspended';

  return (
    <div className="tenant-detail-page">
      <div className="page-container">
        <div className="page-header">
          <div>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')} style={{ marginBottom: 'var(--space-2)' }}>
              ← Back to Dashboard
            </button>
            <h1 className="page-title">{org.legal_name}</h1>
            <p className="page-subtitle">
              {org.trade_name && org.trade_name !== org.legal_name ? `${org.trade_name} • ` : ''}
              {org.country_code} • Onboarded {new Date(org.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <span className={`pill pill-${statusClass}`}>
            <span className="pill-dot" />
            {org.license_status === 'grace_period' ? 'Grace Period' : org.license_status}
          </span>
        </div>

        {/* License Info Card */}
        <div className="detail-grid">
          <div className="glass-card detail-card">
            <h3 className="detail-card-title">License Information</h3>
            <div className="detail-rows">
              <div className="detail-row"><span>Status</span><strong className={`text-${statusClass}`}>{org.license_status}</strong></div>
              <div className="detail-row"><span>Starts</span><strong>{new Date(org.license_starts_at).toLocaleDateString()}</strong></div>
              <div className="detail-row"><span>Expires</span><strong>{new Date(org.license_expires_at).toLocaleDateString()}</strong></div>
              <div className="detail-row"><span>Org Status</span><strong>{org.status}</strong></div>
            </div>
          </div>

          {/* Branches */}
          <div className="glass-card detail-card">
            <h3 className="detail-card-title">Branches ({branches.length})</h3>
            {branches.length === 0 ? (
              <p className="detail-empty">No branches found.</p>
            ) : (
              <div className="detail-list">
                {branches.map((b) => (
                  <div key={b.id} className="detail-list-item">
                    <div>
                      <div className="detail-list-name">{b.name}</div>
                      <div className="detail-list-meta">{b.branch_code}</div>
                    </div>
                    <span className={`pill pill-${b.status === 'active' ? 'active' : 'suspended'}`}>
                      {b.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Members */}
          <div className="glass-card detail-card" style={{ gridColumn: '1 / -1' }}>
            <h3 className="detail-card-title">Members ({members.length})</h3>
            {members.length === 0 ? (
              <p className="detail-empty">No members found.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Member Type</th>
                    <th>App Role</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.user_id}>
                      <td style={{ fontWeight: 600 }}>{m.users?.name || '—'}</td>
                      <td>{m.users?.email || '—'}</td>
                      <td>{m.member_type}</td>
                      <td>{m.app_roles?.name || '—'} {m.app_roles?.level ? `(Lv.${m.app_roles.level})` : ''}</td>
                      <td>
                        <span className={`pill pill-${m.status === 'active' ? 'active' : 'expired'}`}>
                          {m.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
