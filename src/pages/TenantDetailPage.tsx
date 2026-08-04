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

interface Terminal {
  id: string;
  terminal_code: string;
  device_type: string;
  status: string;
  branches: { name: string } | null;
}

interface Printer {
  id: string;
  name: string;
  type: string;
  status: string;
  is_default: boolean;
  branches: { name: string } | null;
}

interface StockLocation {
  id: string;
  code: string;
  name: string;
  kind: string;
  is_active: boolean;
  branch_id: string | null;
}

export default function TenantDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const [org, setOrg] = useState<Organization | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [stockLocations, setStockLocations] = useState<StockLocation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orgId) fetchAll();
  }, [orgId]);

  async function fetchAll() {
    setLoading(true);

    const [orgRes, branchRes, memberRes, termRes, printRes, stockRes] = await Promise.all([
      supabase.from('organizations').select('*').eq('id', orgId!).single(),
      supabase.from('branches').select('id, name, branch_code, status').eq('organization_id', orgId!),
      supabase.from('organization_memberships')
        .select('user_id, member_type, status, users!user_id(email, name), app_roles:role_id(name, level)')
        .eq('organization_id', orgId!),
      supabase.from('terminals').select('id, terminal_code, device_type, status, branches(name)').eq('organization_id', orgId!),
      supabase.from('printers').select('id, name, type, status, is_default, branches(name)').eq('organization_id', orgId!),
      supabase.schema('ims').from('stock_locations').select('id, code, name, kind, is_active, branch_id').eq('organization_id', orgId!),
    ]);

    if (orgRes.data) setOrg(orgRes.data as Organization);
    if (branchRes.data) setBranches(branchRes.data as Branch[]);
    if (memberRes.data) setMembers(memberRes.data as unknown as MemberRow[]);
    if (termRes.data) setTerminals(termRes.data as unknown as Terminal[]);
    if (printRes.data) setPrinters(printRes.data as unknown as Printer[]);
    if (stockRes.data) setStockLocations(stockRes.data as unknown as StockLocation[]);
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

        {/* Overview Grid */}
        <div className="detail-grid">
          {/* License Info Card */}
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
                      <div className="detail-list-meta">Code: {b.branch_code}</div>
                    </div>
                    <span className={`pill pill-${b.status === 'active' ? 'active' : 'suspended'}`}>
                      {b.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* POS Terminals */}
          <div className="glass-card detail-card">
            <h3 className="detail-card-title">POS Terminals ({terminals.length})</h3>
            {terminals.length === 0 ? (
              <p className="detail-empty">No POS terminals provisioned.</p>
            ) : (
              <div className="detail-list">
                {terminals.map((t) => (
                  <div key={t.id} className="detail-list-item">
                    <div>
                      <div className="detail-list-name">🖥️ {t.terminal_code}</div>
                      <div className="detail-list-meta">{t.device_type} • {t.branches?.name || 'Main Branch'}</div>
                    </div>
                    <span className={`pill pill-${t.status === 'active' ? 'active' : 'suspended'}`}>
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Printers */}
          <div className="glass-card detail-card">
            <h3 className="detail-card-title">Printers ({printers.length})</h3>
            {printers.length === 0 ? (
              <p className="detail-empty">No printers provisioned.</p>
            ) : (
              <div className="detail-list">
                {printers.map((p) => (
                  <div key={p.id} className="detail-list-item">
                    <div>
                      <div className="detail-list-name">🖨️ {p.name} {p.is_default ? '⭐' : ''}</div>
                      <div className="detail-list-meta">{p.type} • {p.branches?.name || 'Main Branch'}</div>
                    </div>
                    <span className={`pill pill-${p.status === 'connected' || p.status === 'active' ? 'active' : 'suspended'}`}>
                      {p.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inventory Stock Locations */}
          <div className="glass-card detail-card" style={{ gridColumn: '1 / -1' }}>
            <h3 className="detail-card-title">Stock & Warehouse Locations ({stockLocations.length})</h3>
            {stockLocations.length === 0 ? (
              <p className="detail-empty">No stock locations provisioned.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Location Code</th>
                    <th>Name</th>
                    <th>Kind</th>
                    <th>Branch</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stockLocations.map((loc) => (
                    <tr key={loc.id}>
                      <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>📦 {loc.code}</td>
                      <td>{loc.name}</td>
                      <td style={{ textTransform: 'capitalize' }}>{loc.kind}</td>
                      <td>{branches.find((b) => b.id === loc.branch_id)?.name || '—'}</td>
                      <td>
                        <span className={`pill pill-${loc.is_active ? 'active' : 'suspended'}`}>
                          {loc.is_active ? 'active' : 'inactive'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                      <td style={{ textTransform: 'capitalize' }}>{m.member_type}</td>
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
