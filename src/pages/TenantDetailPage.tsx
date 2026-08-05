import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AddResourceModal, { type ModalMode } from '../components/AddResourceModal';
import ExtendLicenseModal from '../components/ExtendLicenseModal';
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

const COUNTRY_NAMES: Record<string, { name: string; flag: string }> = {
  AE: { name: 'United Arab Emirates', flag: '🇦🇪' },
  SA: { name: 'Saudi Arabia', flag: '🇸🇦' },
  OM: { name: 'Oman', flag: '🇴🇲' },
  BH: { name: 'Bahrain', flag: '🇧🇭' },
  KW: { name: 'Kuwait', flag: '🇰🇼' },
  QA: { name: 'Qatar', flag: '🇶🇦' },
  IN: { name: 'India', flag: '🇮🇳' },
  US: { name: 'United States', flag: '🇺🇸' },
  GB: { name: 'United Kingdom', flag: '🇬🇧' },
};

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
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [showExtendModal, setShowExtendModal] = useState(false);

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

  const countryInfo = COUNTRY_NAMES[org.country_code.toUpperCase()] || { name: org.country_code, flag: '🌐' };

  return (
    <div className="tenant-detail-page">
      <div className="page-container">
        {/* Top Tenant Identity Card */}
        <div className="glass-card tenant-header-card">
          <div className="tenant-header-top">
            <div>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')} style={{ marginBottom: 'var(--space-3)' }}>
                ← Back to Dashboard
              </button>
              <div className="tenant-title-row">
                <h1 className="tenant-title">{org.legal_name}</h1>
                <span className={`pill pill-${statusClass}`}>
                  <span className="pill-dot" />
                  {org.license_status === 'grace_period' ? 'Grace Period' : org.license_status}
                </span>
              </div>
              {org.trade_name && org.trade_name !== org.legal_name && (
                <div className="tenant-trade-name">Trading as <strong>{org.trade_name}</strong></div>
              )}
            </div>
          </div>

          <div className="tenant-meta-chips">
            <div className="meta-chip">
              <span className="chip-label">Country</span>
              <span className="chip-value">{countryInfo.flag} {countryInfo.name} ({org.country_code})</span>
            </div>
            <div className="meta-chip">
              <span className="chip-label">Onboarded Date</span>
              <span className="chip-value">📅 {new Date(org.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            </div>
            <div className="meta-chip">
              <span className="chip-label">License Timeline</span>
              <span className="chip-value">⏱️ {new Date(org.license_starts_at).toLocaleDateString()} — {new Date(org.license_expires_at).toLocaleDateString()}</span>
            </div>
            <div className="meta-chip">
              <span className="chip-label">Organization ID</span>
              <code className="chip-value code-id">{org.id}</code>
            </div>
          </div>
        </div>

        {/* Overview Grid */}
        <div className="detail-grid">
          {/* License Info Card */}
          <div className="glass-card detail-card">
            <div className="card-header-with-action">
              <h3 className="detail-card-title" style={{ marginBottom: 0, borderBottom: 'none' }}>License Information</h3>
              <button className="btn btn-success btn-xs" onClick={() => setShowExtendModal(true)}>Extend License</button>
            </div>
            <div className="detail-rows" style={{ marginTop: 'var(--space-3)' }}>
              <div className="detail-row"><span>Status</span><strong className={`text-${statusClass}`}>{org.license_status}</strong></div>
              <div className="detail-row"><span>Starts</span><strong>{new Date(org.license_starts_at).toLocaleDateString()}</strong></div>
              <div className="detail-row"><span>Expires</span><strong>{new Date(org.license_expires_at).toLocaleDateString()}</strong></div>
              <div className="detail-row"><span>Org Status</span><strong>{org.status}</strong></div>
            </div>
          </div>

          {/* Branches */}
          <div className="glass-card detail-card">
            <div className="card-header-with-action">
              <h3 className="detail-card-title" style={{ marginBottom: 0, borderBottom: 'none' }}>Branches ({branches.length})</h3>
              <button className="btn btn-primary btn-xs" onClick={() => setModalMode('branch')}>+ Add Branch</button>
            </div>
            {branches.length === 0 ? (
              <p className="detail-empty">No branches found.</p>
            ) : (
              <div className="detail-list" style={{ marginTop: 'var(--space-3)' }}>
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
            <div className="card-header-with-action">
              <h3 className="detail-card-title" style={{ marginBottom: 0, borderBottom: 'none' }}>POS Terminals ({terminals.length})</h3>
              <button className="btn btn-primary btn-xs" onClick={() => setModalMode('terminal')} disabled={branches.length === 0}>+ Add Terminal</button>
            </div>
            {terminals.length === 0 ? (
              <p className="detail-empty">No POS terminals provisioned.</p>
            ) : (
              <div className="detail-list" style={{ marginTop: 'var(--space-3)' }}>
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
            <div className="card-header-with-action">
              <h3 className="detail-card-title" style={{ marginBottom: 0, borderBottom: 'none' }}>Printers ({printers.length})</h3>
              <button className="btn btn-primary btn-xs" onClick={() => setModalMode('printer')} disabled={branches.length === 0}>+ Add Printer</button>
            </div>
            {printers.length === 0 ? (
              <p className="detail-empty">No printers provisioned.</p>
            ) : (
              <div className="detail-list" style={{ marginTop: 'var(--space-3)' }}>
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
            <div className="card-header-with-action">
              <h3 className="detail-card-title" style={{ marginBottom: 0, borderBottom: 'none' }}>Stock & Warehouse Locations ({stockLocations.length})</h3>
              <button className="btn btn-primary btn-xs" onClick={() => setModalMode('stock_location')} disabled={branches.length === 0}>+ Add Location</button>
            </div>
            {stockLocations.length === 0 ? (
              <p className="detail-empty">No stock locations provisioned.</p>
            ) : (
              <table className="data-table" style={{ marginTop: 'var(--space-3)' }}>
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
            <div className="card-header-with-action">
              <h3 className="detail-card-title" style={{ marginBottom: 0, borderBottom: 'none' }}>Members ({members.length})</h3>
              <button className="btn btn-primary btn-xs" onClick={() => setModalMode('member')}>+ Add Member</button>
            </div>
            {members.length === 0 ? (
              <p className="detail-empty">No members found.</p>
            ) : (
              <table className="data-table" style={{ marginTop: 'var(--space-3)' }}>
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

      {modalMode && org && (
        <AddResourceModal
          mode={modalMode}
          orgId={org.id}
          orgName={org.legal_name}
          branches={branches}
          onClose={() => setModalMode(null)}
          onSuccess={fetchAll}
        />
      )}

      {showExtendModal && org && (
        <ExtendLicenseModal
          org={org}
          onClose={() => setShowExtendModal(false)}
          onSuccess={fetchAll}
        />
      )}
    </div>
  );
}
