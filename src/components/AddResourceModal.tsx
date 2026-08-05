import { useState, useEffect, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import './AddResourceModal.css';

export type ModalMode = 'branch' | 'terminal' | 'printer' | 'stock_location' | 'member';

interface BranchOption {
  id: string;
  name: string;
}

interface AppRoleOption {
  id: string;
  name: string;
  level: number;
}

interface AddResourceModalProps {
  mode: ModalMode;
  orgId: string;
  orgName: string;
  branches: BranchOption[];
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddResourceModal({
  mode,
  orgId,
  orgName,
  branches,
  onClose,
  onSuccess,
}: AddResourceModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [appRoles, setAppRoles] = useState<AppRoleOption[]>([]);

  // Form states
  const [branchName, setBranchName] = useState('');
  const [branchCode, setBranchCode] = useState('');

  const [terminalCode, setTerminalCode] = useState('');
  const [deviceType, setDeviceType] = useState('POS Laptop');
  const [selectedBranchId, setSelectedBranchId] = useState(branches[0]?.id || '');

  const [printerName, setPrinterName] = useState('');
  const [printerType, setPrinterType] = useState('receipt');
  const [isDefaultPrinter, setIsDefaultPrinter] = useState(false);

  const [locationCode, setLocationCode] = useState('');
  const [locationName, setLocationName] = useState('');
  const [locationKind, setLocationKind] = useState('store');

  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberType, setMemberType] = useState('staff');
  const [selectedRoleId, setSelectedRoleId] = useState('');

  useEffect(() => {
    if (mode === 'member') {
      supabase.from('app_roles').select('id, name, level').order('level', { ascending: false }).then(({ data }) => {
        if (data) {
          setAppRoles(data as AppRoleOption[]);
          if (data.length > 0) setSelectedRoleId(data[0].id);
        }
      });
    }
  }, [mode]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'branch') {
        const { error: insertErr } = await supabase.from('branches').insert({
          organization_id: orgId,
          name: branchName.trim(),
          branch_code: branchCode.trim().toUpperCase(),
          status: 'active',
        });
        if (insertErr) throw insertErr;
      } else if (mode === 'terminal') {
        const { error: insertErr } = await supabase.from('terminals').insert({
          organization_id: orgId,
          branch_id: selectedBranchId || branches[0]?.id,
          terminal_code: terminalCode.trim().toUpperCase(),
          device_type: deviceType,
          status: 'active',
        });
        if (insertErr) throw insertErr;
      } else if (mode === 'printer') {
        const { error: insertErr } = await supabase.from('printers').insert({
          organization_id: orgId,
          branch_id: selectedBranchId || branches[0]?.id,
          name: printerName.trim(),
          type: printerType,
          status: 'connected',
          is_default: isDefaultPrinter,
        });
        if (insertErr) throw insertErr;
      } else if (mode === 'stock_location') {
        const { error: insertErr } = await supabase.schema('ims').from('stock_locations').insert({
          organization_id: orgId,
          branch_id: selectedBranchId || branches[0]?.id,
          code: locationCode.trim().toUpperCase(),
          name: locationName.trim(),
          kind: locationKind,
          is_active: true,
        });
        if (insertErr) throw insertErr;
      } else if (mode === 'member') {
        let userId: string | null = null;
        const { data: existingUser } = await supabase.from('users').select('id').eq('email', memberEmail.trim().toLowerCase()).maybeSingle();
        
        if (existingUser) {
          userId = existingUser.id;
        } else {
          const newId = crypto.randomUUID();
          const { error: userErr } = await supabase.from('users').insert({
            id: newId,
            email: memberEmail.trim().toLowerCase(),
            name: memberName.trim(),
          });
          if (userErr) throw userErr;
          userId = newId;
        }

        const { error: memberErr } = await supabase.from('organization_memberships').insert({
          organization_id: orgId,
          user_id: userId,
          role_id: selectedRoleId || appRoles[0]?.id,
          member_type: memberType,
          status: 'active',
        });
        if (memberErr) throw memberErr;
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      const e = err as { message?: string };
      console.error(`Error adding ${mode}:`, e);
      setError(e.message || `Failed to add ${mode}`);
    } finally {
      setLoading(false);
    }
  };

  const titles: Record<ModalMode, string> = {
    branch: 'Add New Branch',
    terminal: 'Provision POS Terminal',
    printer: 'Add Hardware Printer',
    stock_location: 'Add Stock & Warehouse Location',
    member: 'Add Member / Staff',
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">{titles[mode]}</h2>
            <p className="modal-subtitle">Target Tenant: <strong>{orgName}</strong></p>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="form-error">{error}</div>}

          {/* Mode 1: Branch */}
          {mode === 'branch' && (
            <>
              <div className="form-group">
                <label className="form-label">Branch Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Al Karama Branch"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Branch Code</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. BR-02"
                  value={branchCode}
                  onChange={(e) => setBranchCode(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          {/* Mode 2: Terminal */}
          {mode === 'terminal' && (
            <>
              <div className="form-group">
                <label className="form-label">Terminal Code</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. DZCK-TERM-02"
                  value={terminalCode}
                  onChange={(e) => setTerminalCode(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Device Type</label>
                <select className="form-select" value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>
                  <option value="POS Laptop">POS Laptop</option>
                  <option value="Tablet">Tablet</option>
                  <option value="Mobile POS">Mobile POS Handheld</option>
                  <option value="Kiosk">Self-Service Kiosk</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Assigned Branch</label>
                <select className="form-select" value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)} required>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Mode 3: Printer */}
          {mode === 'printer' && (
            <>
              <div className="form-group">
                <label className="form-label">Printer Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Kitchen Thermal Printer 2"
                  value={printerName}
                  onChange={(e) => setPrinterName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Printer Type</label>
                <select className="form-select" value={printerType} onChange={(e) => setPrinterType(e.target.value)}>
                  <option value="receipt">Receipt Printer</option>
                  <option value="kitchen">Kitchen Ticket Printer</option>
                  <option value="label">Barcode & Label Printer</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Assigned Branch</label>
                <select className="form-select" value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)} required>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group-checkbox">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={isDefaultPrinter}
                    onChange={(e) => setIsDefaultPrinter(e.target.checked)}
                  />
                  Set as Default Printer for this branch
                </label>
              </div>
            </>
          )}

          {/* Mode 4: Stock Location */}
          {mode === 'stock_location' && (
            <>
              <div className="form-group">
                <label className="form-label">Location Code</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. DZCK-ST-002"
                  value={locationCode}
                  onChange={(e) => setLocationCode(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Location Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Central Warehouse Al Quoz"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Location Kind</label>
                <select className="form-select" value={locationKind} onChange={(e) => setLocationKind(e.target.value)}>
                  <option value="store">Retail Store Room</option>
                  <option value="warehouse">Central Warehouse</option>
                  <option value="transit">In-Transit Storage</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Assigned Branch</label>
                <select className="form-select" value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)} required>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Mode 5: Member */}
          {mode === 'member' && (
            <>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Jane Doe"
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="jane.doe@tenant.com"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Member Type</label>
                <select className="form-select" value={memberType} onChange={(e) => setMemberType(e.target.value)}>
                  <option value="staff">Staff Member</option>
                  <option value="owner">Organization Owner</option>
                  <option value="partner">Franchise Partner</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">App Role</label>
                <select className="form-select" value={selectedRoleId} onChange={(e) => setSelectedRoleId(e.target.value)} required>
                  {appRoles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} (Level {r.level})</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : null}
              {loading ? 'Creating...' : `Save ${titles[mode].replace('Add ', '').replace('Provision ', '')}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
